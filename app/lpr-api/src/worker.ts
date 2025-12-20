import * as amqp from 'amqplib';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const queueName = process.env.RABBITMQ_QUEUE || 'lpr.events';

function amqpUrl() {
  if (process.env.RABBITMQ_URL) return process.env.RABBITMQ_URL;
  const user = process.env.RABBITMQ_USER || 'admin';
  const pass = process.env.RABBITMQ_PASS || 'admin';
  const host = process.env.RABBITMQ_INTERNAL_HOST || 'rabbitmq';
  const port = process.env.RABBITMQ_INTERNAL_PORT || '5672';
  return `amqp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
}

async function main() {
  console.log(`[worker] connecting to rabbitmq...`);
  const conn = await amqp.connect(amqpUrl());
  const ch = await conn.createChannel();
  await ch.assertQueue(queueName, { durable: true });

  console.log(`[worker] consuming queue: ${queueName}`);

  ch.consume(queueName, async (msg) => {
    if (!msg) return;

    try {
      const payload = JSON.parse(msg.content.toString('utf-8'));
      console.log('[worker] received:', payload);

      if (payload?.type === 'LPR_EVENT_CREATED' && payload?.eventId) {
        const ev = await prisma.lprEvent.findUnique({ where: { id: payload.eventId } });
        console.log('[worker] db event:', ev?.id, ev?.plate, ev?.imageUrl);
      }

      ch.ack(msg);
    } catch (e) {
      console.error('[worker] error:', e);
      // requeue=false para não entrar em loop infinito
      ch.nack(msg, false, false);
    }
  });

  process.on('SIGINT', async () => {
    console.log('[worker] shutting down...');
    await ch.close().catch(() => {});
    await conn.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('[worker] fatal:', e);
  process.exit(1);
});
