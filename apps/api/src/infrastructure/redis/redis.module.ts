import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_ENV } from '../../config/config.module';
import { buildRedisUrl, type Env } from '../../config/env.schema';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Klien Redis untuk cache schema form + broker BullMQ. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_ENV],
      useFactory: (env: Env): Redis => {
        const logger = new Logger('RedisClient');
        const client = new Redis(buildRedisUrl(env), {
          // Wajib null untuk BullMQ; juga mencegah request menggantung selamanya.
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
        });

        client.on('error', (error: Error) => logger.error(`Redis error: ${error.message}`));
        client.on('ready', () => logger.log('Redis siap'));

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
    this.logger.log('Koneksi Redis ditutup');
  }
}
