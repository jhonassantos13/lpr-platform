import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MinioService } from './minio/minio.service';

type AnprPayload = {
  plate?: string;
  confidence?: number;
  imageUrl?: string;
  imageBase64?: string;
};

@Injectable()
export class AnprService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  async handleWebhook(cameraToken: string | undefined, body: AnprPayload) {
    if (!cameraToken) {
      throw new UnauthorizedException('missing x-camera-token');
    }

    const camera = await this.prisma.camera.findUnique({
      where: { token: cameraToken },
    });

    if (!camera) {
      throw new UnauthorizedException('invalid camera token');
    }

    const plate = String(body?.plate || '').trim();
    const confidence = Number(body?.confidence || 0);

    if (!plate) {
      throw new BadRequestException('missing plate');
    }

    let finalImageUrl: string | null = null;

    if (body?.imageBase64) {
      finalImageUrl = await this.minio.uploadBase64(String(body.imageBase64));
    } else if (body?.imageUrl) {
      finalImageUrl = String(body.imageUrl);
    }

    const event = await this.prisma.lprEvent.create({
      data: {
        plate,
        confidence,
        imageUrl: finalImageUrl,
        cameraId: camera.id,
      },
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
