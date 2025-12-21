import { Module } from '@nestjs/common';
import { QueueModule } from './queue/queue.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { HealthController } from './health.controller';
import { AnprController } from './anpr.controller';

import { PrismaService } from './prisma.service';
import { MinioService } from './minio/minio.service';

@Module({
  imports: [QueueModule],
  controllers: [AppController, HealthController, AnprController],
  providers: [AppService, PrismaService, MinioService],
})
export class AppModule {}
