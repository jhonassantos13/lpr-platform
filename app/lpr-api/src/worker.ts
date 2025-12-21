import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { RabbitMQService, LprEventMessageV1 } from './queue/rabbitmq.service';
import { PrismaService } from './prisma.service';

type OutboxRow = {
  id: string;
  eventId: string;
  payload: unknown;
  attempts: number;
};

async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const rabbit = app.get(RabbitMQService);
  const prisma = app.get(PrismaService);

  // Worker ID para lock
  const workerId = process.env.WORKER_ID ?? `worker-${randomUUID()}`;
  logger.log(`WORKER_ID=${workerId}`);

  // 1) Consumer da fila (processamento pesado no futuro)
  await rabbit.consumeLprEvents(async (msg) => {
    logger.log(
      `Evento recebido: plate=${msg.plate} confidence=${msg.confidence} cameraId=${msg.cameraId} eventId=${msg.eventId}`,
    );
  });

  // 2) Publisher do Outbox (com lock atômico)
  let running = false;
  const tickMs = Number(process.env.OUTBOX_TICK_MS ?? '1000');
  const batchSize = Number(process.env.OUTBOX_BATCH_SIZE ?? '50');
  const maxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? '10');

  // Se o worker cair com itens "PROCESSING", outro worker pode recuperar após esse TTL
  const lockTtlMs = Number(process.env.OUTBOX_LOCK_TTL_MS ?? String(5 * 60_000)); // 5 min default

  const calcBackoffMs = (attempts: number) => {
    const base = 1000; // 1s
    const max = 60_000; // 60s
    return Math.min(max, base * Math.pow(2, Math.min(10, attempts)));
  };

  const shortErr = (err: unknown) => {
    const s = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return s.length > 1500 ? s.slice(0, 1500) : s;
  };

  const claimOutbox = async (): Promise<OutboxRow[]> => {
    const cutoff = new Date(Date.now() - lockTtlMs);

    // Claim atômico: pega PENDING (já vencido) OU PROCESSING travado (lock expirado)
    // FOR UPDATE SKIP LOCKED impede que 2 workers peguem o mesmo item
    const rows = await prisma.$queryRaw<OutboxRow[]>`
      WITH cte AS (
        SELECT id
        FROM "LprEventOutbox"
        WHERE
          (
            status = 'PENDING'
            AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
          )
          OR
          (
            status = 'PROCESSING'
            AND "lockedAt" IS NOT NULL
            AND "lockedAt" < ${cutoff}
          )
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "LprEventOutbox" o
      SET
        status = 'PROCESSING',
        "lockedAt" = NOW(),
        "lockedBy" = ${workerId}
      WHERE o.id IN (SELECT id FROM cte)
      RETURNING o.id, o."eventId", o.payload, o.attempts;
    `;
    return rows;
  };

  const publishOutboxOnce = async () => {
    if (running) return;
    running = true;
    try {
      const rows = await claimOutbox();
      if (rows.length === 0) return;

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
              lockedAt: null,
              lockedBy: null,
              lastError: null,
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
              lockedAt: null,
              lockedBy: null,
              lastError: shortErr(err),
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
    void publishOutboxOnce().catch((err) => {
      logger.error('Erro no loop do Outbox', err instanceof Error ? err.stack : String(err));
    });
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
