import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // (opcional) se você for usar reverse proxy e quiser pegar IP real:
  // app.set('trust proxy', 1);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  await app.listen(port, '0.0.0.0');
}
bootstrap();
