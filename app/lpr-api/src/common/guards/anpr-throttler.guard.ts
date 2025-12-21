import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';

@Injectable()
export class AnprThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // 1) limita por câmera (melhor)
    const token = (req?.headers?.['x-camera-token'] ?? '').toString().trim();
    if (token) return `camera:${token}`;

    // 2) fallback por IP
    const ip =
      (req?.ip ?? '').toString() ||
      (req?.headers?.['x-forwarded-for'] ?? '').toString().split(',')[0].trim() ||
      'unknown';

    return `ip:${ip}`;
  }

  // compatibilidade com versões do Nest/Throttler
  protected getRequestResponse(context: ExecutionContext) {
    const http = context.switchToHttp();
    return { req: http.getRequest(), res: http.getResponse() };
  }
}
