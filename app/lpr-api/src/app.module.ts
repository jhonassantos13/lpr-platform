import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { QueueModule } from './queue/queue.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { HealthController } from './health.controller';
import { CamerasAdminController } from './admin/cameras.controller';
import { AnprController } from './anpr.controller';
import { OutboxAdminController } from './admin/outbox.controller';

import { PrismaService } from './prisma.service';
import { MinioService } from './minio/minio.service';

@Module({
  imports: [QueueModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }])],
  controllers: [AppController, HealthController, AnprController, OutboxAdminController, CamerasAdminController],
  providers: [AppService, PrismaService, MinioService],
})
export class AppModule {}
