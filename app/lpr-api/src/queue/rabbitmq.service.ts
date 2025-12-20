import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';

@Injectable()
export class RabbitMqService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);

  private conn?: ChannelModel;
  private ch?: Channel;

  public readonly queueName = process.env.RABBITMQ_QUEUE || 'lpr.events';

  private get amqpUrl() {
    if (process.env.RABBITMQ_URL) return process.env.RABBITMQ_URL;

    const user = process.env.RABBITMQ_USER || 'admin';
    const pass = process.env.RABBITMQ_PASS || 'admin';
    const host = process.env.RABBITMQ_INTERNAL_HOST || 'rabbitmq';
    const port = process.env.RABBITMQ_INTERNAL_PORT || '5672';
    return `amqp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  }

  private async ensureConnected(): Promise<Channel> {
    if (this.ch) return this.ch;

    for (let attempt = 1; attempt <= 20; attempt++) {
      try {
        this.logger.log(`Connecting to RabbitMQ (attempt ${attempt})...`);

        this.conn = await amqp.connect(this.amqpUrl); // ChannelModel
        this.ch = await this.conn.createChannel();

        await this.ch.assertQueue(this.queueName, { durable: true });

        this.logger.log(`RabbitMQ connected. Queue=${this.queueName}`);
        return this.ch;
      } catch (e: any) {
        this.logger.warn(`RabbitMQ connect failed: ${e?.message || e}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    throw new Error('RabbitMQ connection failed after multiple attempts');
  }

  async publishEvent(payload: any) {
    const ch = await this.ensureConnected();
    const body = Buffer.from(JSON.stringify(payload));

    const ok = ch.sendToQueue(this.queueName, body, {
      persistent: true,
      contentType: 'application/json',
    });

    if (!ok) this.logger.warn('sendToQueue returned false (backpressure).');
  }

  async onModuleDestroy() {
    try {
      await this.ch?.close();
    } catch {}
    try {
      await this.conn?.close();
    } catch {}
    this.ch = undefined;
    this.conn = undefined;
  }
}
