import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_ENV } from '../../config/config.module';
import { buildDatabaseUrl, type Env } from '../../config/env.schema';

export const PG_POOL = Symbol('PG_POOL');

/**
 * Koneksi PostgreSQL mentah (node-postgres).
 * Belum pakai ORM di tahap scaffolding ini; modul fitur nanti tinggal inject PG_POOL.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_ENV],
      useFactory: (env: Env): Pool => {
        const logger = new Logger('PostgresPool');
        const pool = new Pool({
          connectionString: buildDatabaseUrl(env),
          max: env.POSTGRES_POOL_MAX,
          connectionTimeoutMillis: 5_000,
          idleTimeoutMillis: 30_000,
        });

        // Tanpa listener ini, error pada koneksi idle bisa menjatuhkan proses Node.
        pool.on('error', (error) => logger.error(`Idle client error: ${error.message}`));

        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
    this.logger.log('Pool PostgreSQL ditutup');
  }
}
