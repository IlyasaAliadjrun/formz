import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_ENV } from './config/config.module';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  const env = app.get<Env>(APP_ENV);

  // CORS dashboard admin dibatasi ke domain dashboard saja.
  // Endpoint publik /public/* nanti punya whitelist origin per form sendiri.
  app.enableCors({
    origin: [env.DASHBOARD_URL],
    credentials: true,
  });

  // Validasi request pakai Zod (schema dari @formz/shared) lewat pipe khusus,
  // ditambahkan bersama modul fitur pertama di part berikutnya.
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, env.API_HOST);

  logger.log(`API berjalan di http://${env.API_HOST}:${env.API_PORT}`);
  logger.log(`Health check: http://${env.API_HOST}:${env.API_PORT}/health`);
}

void bootstrap();
