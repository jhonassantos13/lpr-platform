import { Body, Controller, Headers, Logger, Post } from '@nestjs/common';
import { MinioService } from './minio/minio.service';
import { PrismaService } from './prisma.service';

@Controller('webhook/anpr')
export class AnprController {
  private readonly logger = new Logger(AnprController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  @Post()
  async receive(
    @Headers('x-camera-token') cameraToken: string,
    @Body() body: any,
  ) {
    if (!cameraToken) return { ok: false, error: 'missing x-camera-token' };

    const camera = await this.prisma.camera.findUnique({ where: { token: cameraToken } });
    if (!camera) return { ok: false, error: 'invalid camera token' };

    const plate = String(body.plate || '').trim();
    const confidenceInput = Number(body.confidence || 0);
    const confidenceSafe = Number.isFinite(confidenceInput) ? confidenceInput : 0;

    if (!plate) return { ok: false, error: 'missing plate' };

    let finalImageUrl: string | null = null;
    if (body.imageBase64) {
      finalImageUrl = await this.minio.uploadBase64(String(body.imageBase64));
    } else if (body.imageUrl) {
      finalImageUrl = String(body.imageUrl);
    }

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lprEvent.create({
        data: {
          plate,
          confidence: confidenceSafe,
          imageUrl: finalImageUrl,
          cameraId: camera.id,
        },
      });

      const payload = {
        schemaVersion: 1,
        eventId: created.id,
        cameraId: created.cameraId,
        plate: created.plate,
        confidence: typeof created.confidence === 'number' ? created.confidence : confidenceSafe,
        imageUrl: created.imageUrl ?? null,
        createdAt: created.createdAt.toISOString(),
      };

      await tx.lprEventOutbox.create({
        data: {
          eventId: created.id,
          payload,
          status: 'PENDING',
        },
      });

      return created;
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
