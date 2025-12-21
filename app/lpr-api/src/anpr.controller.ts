import { Body, Controller, Headers, Logger, Post, UseGuards, Req, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AnprThrottlerGuard } from './common/guards/anpr-throttler.guard';
import { MinioService } from './minio/minio.service';
import { PrismaService } from './prisma.service';

const ipaddr = require('ipaddr.js') as any;
const ANPR_RATE_TTL = Number(process.env.ANPR_RATE_TTL ?? '60000');
const ANPR_RATE_LIMIT = Number(process.env.ANPR_RATE_LIMIT ?? '30');


function getClientIp(req: any): string {
  const xff = (req?.headers?.['x-forwarded-for'] || '').toString();
  if (xff) return xff.split(',')[0].trim();

  const ra = (req?.socket?.remoteAddress || '').toString().trim();
  if (ra) return ra;

  return 'unknown';
}

function isIpAllowed(ip: string, cidrs: string[]): boolean {
  if (!cidrs || cidrs.length === 0) return true; // allow-all
  if (!ip || ip === 'unknown') return false;

  const normalized = ip.startsWith('::ffff:') ? ip.replace('::ffff:', '') : ip;

  let addr: any;
  try {
    addr = ipaddr.parse(normalized);
  } catch {
    return false;
  }

  for (const raw of cidrs) {
    const cidr = (raw || '').trim();
    if (!cidr) continue;
    try {
      const parsed = ipaddr.parseCIDR(cidr); // [range, bits]
      const range = parsed[0];
      const bits = parsed[1];
      if (addr.kind() !== range.kind()) continue;
      if (addr.match([range, bits])) return true;
    } catch {
      continue;
    }
  }
  return false;
}

@Controller('webhook/anpr')
export class AnprController {
  private readonly logger = new Logger(AnprController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  @UseGuards(AnprThrottlerGuard)
  @Throttle({ default: { limit: ANPR_RATE_LIMIT, ttl: ANPR_RATE_TTL } })
  @Post()
  async receive(
    @Headers('x-camera-token') cameraToken: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    if (!cameraToken) return { ok: false, error: 'missing x-camera-token' };

    const camera = await this.prisma.camera.findUnique({ where: { token: cameraToken } });
    if (!camera) throw new UnauthorizedException('invalid camera token');

      // IP allowlist por câmera: vazio = aceita qualquer IP
      const clientIp = getClientIp(req);
      let cidrs: string[] = [];
      try {
        const rows = await this.prisma.$queryRaw<any[]>`
          SELECT "allowedCidrs" FROM "Camera" WHERE "id" = ${camera.id} LIMIT 1
        `;
        cidrs = (rows?.[0]?.allowedCidrs ?? []) as string[];
      } catch (err: any) {
        this.logger.error(`Falha ao carregar allowedCidrs: ${err?.message || err}`);
      }
      if (cidrs.length > 0 && !isIpAllowed(clientIp, cidrs)) {
        this.logger.warn(`Webhook bloqueado por IP: ip=${clientIp} cameraId=${camera.id} cidrs=${cidrs.join(',')}`);
        throw new ForbiddenException('ip not allowed');
      }


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
