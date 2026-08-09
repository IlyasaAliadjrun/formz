import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_ENV } from './config/config.module';
import type { Env } from './config/env.schema';
import { createCorsDelegate } from './modules/public/public-cors';
import { PublicFormsService } from './modules/public/public-forms.service';

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

  app.enableShutdownHooks();

  await app.listen(env.API_PORT, env.API_HOST);

  logger.log(`API berjalan di http://${env.API_HOST}:${env.API_PORT}`);
  logger.log(`Health check: http://${env.API_HOST}:${env.API_PORT}/health`);
}

void bootstrap();
