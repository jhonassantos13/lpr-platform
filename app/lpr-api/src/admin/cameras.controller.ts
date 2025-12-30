import { Body, Controller, Headers, Param, Patch, Post, Get, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import crypto from 'crypto';

type CameraCreateBody = {
  name: string;
  allowedCidrs?: string[];
};

type CameraUpdateBody = {
  name?: string;
  allowedCidrs?: string[];
};

const ipaddr = require('ipaddr.js') as any;

function normalizeCidrs(cidrs: unknown): string[] {
  if (cidrs === undefined || cidrs === null) return [];
  if (!Array.isArray(cidrs)) throw new BadRequestException('allowedCidrs must be an array of strings');

  const out: string[] = [];
  for (const item of cidrs) {
    const v = String(item ?? '').trim();
    if (!v) continue;
    // valida CIDR (IPv4/IPv6)
    try {
      ipaddr.parseCIDR(v);
    } catch {
      throw new BadRequestException(`invalid CIDR: ${v}`);
    }
    out.push(v);
  }

  // evita payload gigante
  if (out.length > 100) throw new BadRequestException('allowedCidrs too large (max 100)');
  return out;
}

function newToken(): string {
  // token “hex” longo (simples e forte)
  return crypto.randomBytes(32).toString('hex');
}

@Controller('admin/cameras')
export class CamerasAdminController {
  constructor(private readonly prisma: PrismaService) {}

  private assertAdmin(adminKey: string | undefined) {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) throw new UnauthorizedException('ADMIN_API_KEY not configured');
    if (!adminKey || adminKey !== expected) throw new UnauthorizedException('invalid admin key');
  }

  @Get()
  async list(@Headers('x-admin-key') adminKey: string | undefined) {
    this.assertAdmin(adminKey);

    const items = await this.prisma.camera.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        name: true,
        token: true,
        allowedCidrs: true,
        createdAt: true,
      },
    });

    return { ok: true, items };
  }

  @Post()
  async create(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Body() body: CameraCreateBody,
  ) {
    this.assertAdmin(adminKey);

    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException('missing name');

    const allowedCidrs = normalizeCidrs(body?.allowedCidrs);

    const camera = await this.prisma.camera.create({
      data: {
        name,
        token: newToken(),
        allowedCidrs,
      },
      select: {
        id: true,
        name: true,
        token: true,
        allowedCidrs: true,
        createdAt: true,
      },
    });

    return { ok: true, camera };
  }

  @Patch(':id')
  async update(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Param('id') id: string,
    @Body() body: CameraUpdateBody,
  ) {
    this.assertAdmin(adminKey);

    const data: any = {};

    if (body?.name !== undefined) {
      const name = String(body.name ?? '').trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      data.name = name;
    }

    if (body?.allowedCidrs !== undefined) {
      data.allowedCidrs = normalizeCidrs(body.allowedCidrs);
    }

    if (Object.keys(data).length === 0) throw new BadRequestException('nothing to update');

    const camera = await this.prisma.camera.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        token: true,
        allowedCidrs: true,
        createdAt: true,
      },
    });

    return { ok: true, camera };
  }

  @Post(':id/rotate-token')
  async rotateToken(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Param('id') id: string,
  ) {
    this.assertAdmin(adminKey);

    const camera = await this.prisma.camera.update({
      where: { id },
      data: { token: newToken() },
      select: {
        id: true,
        name: true,
        token: true,
        allowedCidrs: true,
        createdAt: true,
      },
    });

    return { ok: true, camera };
  }
}
