import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RabbitMQService, LprEventMessageV1 } from './queue/rabbitmq.service';
import { PrismaService } from './prisma.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const rabbit = app.get(RabbitMQService);
  const prisma = app.get(PrismaService);

  // 1) Consumer da fila (processamento pesado no futuro)
  await rabbit.consumeLprEvents(async (msg) => {
    logger.log(
      `Evento recebido: plate=${msg.plate} confidence=${msg.confidence} cameraId=${msg.cameraId} eventId=${msg.eventId}`,
    );
  });

  // 2) Publisher do Outbox (não perde eventos se o RabbitMQ cair)
  let running = false;
  const tickMs = Number(process.env.OUTBOX_TICK_MS ?? '1000');
  const batchSize = Number(process.env.OUTBOX_BATCH_SIZE ?? '50');
  const maxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? '10');

  const calcBackoffMs = (attempts: number) => {
    const base = 1000; // 1s
    const max = 60_000; // 60s
    const exp = Math.min(max, base * Math.pow(2, Math.min(10, attempts)));
    return exp;
  };

  const publishOutboxOnce = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const rows = await prisma.lprEventOutbox.findMany({
        where: {
          status: 'PENDING',
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });

      for (const row of rows) {
        const payload = row.payload as unknown as LprEventMessageV1;

        try {
          await rabbit.publishLprEvent(payload);

          await prisma.lprEventOutbox.update({
            where: { id: row.id },
            data: {
              status: 'PUBLISHED',
              publishedAt: new Date(),
              nextRetryAt: null,
            },
          });
        } catch (err) {
          const attempts = (row.attempts ?? 0) + 1;
          const nextRetryAt = new Date(Date.now() + calcBackoffMs(attempts));

          await prisma.lprEventOutbox.update({
            where: { id: row.id },
            data: {
              attempts,
              nextRetryAt,
              status: attempts >= maxAttempts ? 'FAILED' : 'PENDING',
            },
          });

          logger.error(
            `Falha ao publicar Outbox id=${row.id} eventId=${row.eventId} attempts=${attempts}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => {
    void publishOutboxOnce();
  }, tickMs);

  const shutdown = async () => {
    logger.warn('Encerrando worker...');
    clearInterval(interval);
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
