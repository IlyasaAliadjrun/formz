import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import { AppModule } from './app.module';
import { APP_ENV } from './config/config.module';
import type { Env } from './config/env.schema';
import { createCorsDelegate } from './modules/public/public-cors';
import { PublicFormsService } from './modules/public/public-forms.service';
import { mountBullBoard } from './modules/queue/bull-board';
import {
  EMAIL_NOTIFICATION_QUEUE,
  REPORT_REFRESH_QUEUE,
  SHEET_SYNC_QUEUE,
} from './modules/queue/queue.constants';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  const env = app.get<Env>(APP_ENV);

  // Hanya dinyalakan kalau memang ada reverse proxy di depan (Part 10). Kalau
  // tidak, `X-Forwarded-For` bisa dipalsukan dan rate limit per IP jadi percuma.
  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
    logger.log('trust proxy aktif — IP klien dibaca dari X-Forwarded-For');
  }

  // Dashboard admin: satu origin tetap, dengan kredensial.
  // Endpoint publik /public/forms/:formKey/*: origin mengikuti whitelist domain
  // milik form tersebut, tanpa kredensial. Keduanya diputuskan per request.
  const publicForms = app.get(PublicFormsService);

  app.enableCors(createCorsDelegate(env, (formKey) => publicForms.originPolicy(formKey)));

  // Halaman pemantauan antrean. Punya autentikasi sendiri (HTTP Basic) dan tidak
  // dipasang sama sekali kalau kredensialnya belum diatur — lihat bull-board.ts.
  const boardMounted = mountBullBoard(app, env, [
    app.get<Queue>(SHEET_SYNC_QUEUE),
    app.get<Queue>(EMAIL_NOTIFICATION_QUEUE),
    app.get<Queue>(REPORT_REFRESH_QUEUE),
  ]);

  app.enableShutdownHooks();

  await app.listen(env.API_PORT, env.API_HOST);

  logger.log(`API berjalan di http://${env.API_HOST}:${env.API_PORT}`);
  logger.log(`Health check: http://${env.API_HOST}:${env.API_PORT}/health`);

  if (boardMounted) {
    logger.log(
      `Pemantauan antrean: http://${env.API_HOST}:${env.API_PORT}${env.QUEUE_DASHBOARD_PATH}`,
    );
  }
}

void bootstrap();
