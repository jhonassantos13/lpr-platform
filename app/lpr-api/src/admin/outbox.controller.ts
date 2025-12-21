import {
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
  BadRequestException,
  Post,
  Param,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';

@Controller('admin/outbox')
export class OutboxAdminController {
  constructor(private readonly prisma: PrismaService) {}

  private assertAdmin(@Headers('x-admin-key') adminKey: string | undefined) {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      // Em produção, sempre configure esta variável.
      throw new UnauthorizedException('ADMIN_API_KEY not configured');
    }
    if (!adminKey || adminKey !== expected) {
      throw new UnauthorizedException('invalid admin key');
    }
  }

  @Get('summary')
  async summary(@Headers('x-admin-key') adminKey: string | undefined) {
    this.assertAdmin(adminKey);

    const grouped = await this.prisma.lprEventOutbox.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    const counts: Record<string, number> = {};
    for (const row of grouped) counts[row.status] = row._count.status;

    return {
      ok: true,
      counts: {
        PENDING: counts.PENDING ?? 0,
        PROCESSING: counts.PROCESSING ?? 0,
        PUBLISHED: counts.PUBLISHED ?? 0,
        FAILED: counts.FAILED ?? 0,
      },
    };
  }

  @Get('recent')
  async recent(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Query('status') status?: OutboxStatus,
    @Query('limit') limitRaw?: string,
  ) {
    this.assertAdmin(adminKey);

    const limit = Math.min(Math.max(Number(limitRaw ?? 50), 1), 200);
    if (!Number.isFinite(limit)) throw new BadRequestException('invalid limit');

    const where = status ? { status } : undefined;

    const rows = await this.prisma.lprEventOutbox.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        eventId: true,
        status: true,
        attempts: true,
        nextRetryAt: true,
        publishedAt: true,
        createdAt: true,
        lockedAt: true,
        lockedBy: true,
        lastError: true,
      },
    });

    return { ok: true, items: rows };
  }

  @Post('retry/:id')
  async retry(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Param('id') id: string,
  ) {
    this.assertAdmin(adminKey);

    const updated = await this.prisma.lprEventOutbox.update({
      where: { id },
      data: {
        status: 'PENDING',
        attempts: 0,
        nextRetryAt: null,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
      select: {
        id: true,
        eventId: true,
        status: true,
        attempts: true,
        nextRetryAt: true,
      },
    });

    return { ok: true, item: updated };
  }
}
