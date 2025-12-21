import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import type { Channel, ChannelModel, ConsumeMessage, Options } from 'amqplib';

export type LprEventMessageV1 = {
  schemaVersion: 1;
  eventId: string;
  cameraId: string;
  plate: string;
  confidence: number;
  imageUrl: string | null;
  createdAt: string; // ISO
};

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);

  private conn: ChannelModel | null = null;
  private channel: Channel | null = null;
  private connecting: Promise<void> | null = null;

  private readonly url: string =
    process.env.RABBITMQ_URL ??
    (() => {
      const user = process.env.RABBITMQ_USER ?? 'admin';
      const pass = process.env.RABBITMQ_PASS ?? 'admin';
      const host = process.env.RABBITMQ_INTERNAL_HOST ?? 'rabbitmq';
      const port = process.env.RABBITMQ_INTERNAL_PORT ?? '5672';
      return `amqp://${user}:${pass}@${host}:${port}`;
    })();

  private readonly prefetch = Number(process.env.RABBITMQ_PREFETCH ?? '50');

  private readonly exchange = process.env.LPR_EXCHANGE ?? 'lpr.events';
  private readonly queue = process.env.LPR_QUEUE ?? 'lpr.events.q';
  private readonly routingKey = process.env.LPR_ROUTING_KEY ?? 'lpr.event.created';

  private readonly dlx = process.env.LPR_DLX ?? 'lpr.events.dlx';
  private readonly dlq = process.env.LPR_DLQ ?? 'lpr.events.dlq';
  private readonly dlRoutingKey = process.env.LPR_DL_ROUTING_KEY ?? 'lpr.event.dead';

  async onModuleInit(): Promise<void> {
    await this.ensureConnected();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async publishLprEvent(message: LprEventMessageV1): Promise<void> {
    await this.publishJson(this.exchange, this.routingKey, message, {
      contentType: 'application/json',
      persistent: true,
      messageId: message.eventId,
      timestamp: Date.now(),
      type: 'lpr.event.created.v1',
    });
  }

  async consumeLprEvents(
    handler: (msg: LprEventMessageV1, raw: ConsumeMessage) => Promise<void> | void,
  ): Promise<void> {
    await this.ensureConnected();
    const ch = this.mustChannel();

    await ch.consume(
      this.queue,
      async (raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw.content.toString('utf-8')) as LprEventMessageV1;
          await handler(parsed, raw);
          ch.ack(raw);
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          this.logger.error('Erro ao processar mensagem. Vai para DLQ (nack requeue=false).', e.stack);
          ch.nack(raw, false, false);
        }
      },
      { noAck: false },
    );

    this.logger.log(`Consumindo fila "${this.queue}" (exchange="${this.exchange}", routingKey="${this.routingKey}")`);
  }

  private async publishJson(
    exchange: string,
    routingKey: string,
    payload: unknown,
    options?: Options.Publish,
  ): Promise<void> {
    await this.ensureConnected();
    const ch = this.mustChannel();

    const body = Buffer.from(JSON.stringify(payload), 'utf-8');
    const ok = ch.publish(exchange, routingKey, body, options);

    if (!ok) {
      this.logger.warn('RabbitMQ publish retornou false (backpressure). Mensagem ficou no buffer do canal.');
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.channel) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.connectWithRetry();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connectWithRetry(): Promise<void> {
    let attempt = 0;

    while (true) {
      attempt += 1;
      try {
        this.logger.log(`Conectando no RabbitMQ (tentativa ${attempt})...`);

        const conn = await amqp.connect(this.url);
        this.conn = conn;

        // eventos existem no ChannelModel (EventEmitter)
        conn.on('error', (err: unknown) => {
          this.logger.error('RabbitMQ connection error', err instanceof Error ? err.stack : String(err));
        });

        conn.on('close', () => {
          this.logger.warn('RabbitMQ connection fechou. Próximo publish/consume vai reconectar.');
          this.conn = null;
          this.channel = null;
        });

        const ch = await conn.createChannel();
        this.channel = ch;

        await ch.prefetch(this.prefetch);
        await this.assertTopology(ch);

        this.logger.log('RabbitMQ conectado e topology OK.');
        return;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(`Falha ao conectar no RabbitMQ: ${e.message}`);

        const delayMs = Math.min(30_000, 500 * Math.pow(2, Math.min(10, attempt)));
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  private async assertTopology(ch: Channel): Promise<void> {
    await ch.assertExchange(this.dlx, 'direct', { durable: true });
    await ch.assertQueue(this.dlq, { durable: true });
    await ch.bindQueue(this.dlq, this.dlx, this.dlRoutingKey);

    await ch.assertExchange(this.exchange, 'direct', { durable: true });

    await ch.assertQueue(this.queue, {
      durable: true,
      deadLetterExchange: this.dlx,
      deadLetterRoutingKey: this.dlRoutingKey,
    });

    await ch.bindQueue(this.queue, this.exchange, this.routingKey);
  }

  private mustChannel(): Channel {
    if (!this.channel) throw new Error('RabbitMQ channel não inicializado');
    return this.channel;
  }

  private async close(): Promise<void> {
    try {
      if (this.channel) await this.channel.close();
    } catch {
      // ignore
    } finally {
      this.channel = null;
    }

    try {
      if (this.conn) await this.conn.close();
    } catch {
      // ignore
    } finally {
      this.conn = null;
    }
  }
}
