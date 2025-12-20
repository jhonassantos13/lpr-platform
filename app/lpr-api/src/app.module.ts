import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { HealthController } from './health.controller';
import { AnprController } from './anpr.controller';

import { PrismaService } from './prisma.service';
import { MinioService } from './minio/minio.service';
import { RabbitMqService } from './queue/rabbitmq.service';

@Module({
  imports: [],
  controllers: [AppController, HealthController, AnprController],
  providers: [AppService, PrismaService, MinioService, RabbitMqService],
})
export class AppModule {}
