import { Body, Controller, Headers, Post } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MinioService } from './minio/minio.service';
import { RabbitMqService } from './queue/rabbitmq.service';

const prisma = new PrismaClient();

@Controller('webhook/anpr')
export class AnprController {
  constructor(
    private readonly minio: MinioService,
    private readonly mq: RabbitMqService,
  ) {}

  @Post()
  async receive(
    @Headers('x-camera-token') cameraToken: string,
    @Body() body: any,
  ) {
    if (!cameraToken) {
      return { ok: false, error: 'missing x-camera-token' };
    }

    const camera = await prisma.camera.findUnique({
      where: { token: cameraToken },
    });

    if (!camera) {
      return { ok: false, error: 'invalid camera token' };
    }

    const plate = String(body.plate || '').trim();
    const confidence = Number(body.confidence || 0);

    if (!plate) {
      return { ok: false, error: 'missing plate' };
    }

    let finalImageUrl: string | null = null;

    if (body.imageBase64) {
      finalImageUrl = await this.minio.uploadBase64(String(body.imageBase64));
    } else if (body.imageUrl) {
      finalImageUrl = String(body.imageUrl);
    }

    const event = await prisma.lprEvent.create({
      data: {
        plate,
        confidence,
        imageUrl: finalImageUrl,
        cameraId: camera.id,
      },
    });

    // Publica na fila (não bloqueia o retorno)
    await this.mq.publishEvent({
      type: 'LPR_EVENT_CREATED',
      eventId: event.id,
      cameraId: event.cameraId,
      plate: event.plate,
      createdAt: event.createdAt,
    });

    return {
      ok: true,
      eventId: event.id,
      plate: event.plate,
      confidence: event.confidence,
      cameraId: event.cameraId,
      imageUrl: event.imageUrl,
      createdAt: event.createdAt,
    };
  }
}
