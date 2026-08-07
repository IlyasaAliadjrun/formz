import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_ENV } from '../../config/config.module';
import { buildDatabaseUrl, type Env } from '../../config/env.schema';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * Klien Prisma tunggal untuk seluruh aplikasi.
 *
 * Prisma 7 memakai query compiler tanpa engine Rust, jadi koneksi database
 * disediakan lewat driver adapter — di sini `@prisma/adapter-pg`, yang di
 * baliknya tetap memakai connection pool `pg`. Konsekuensinya cuma ada satu
 * pool di proses ini, bukan dua seperti kalau `pg.Pool` dipakai berdampingan.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(APP_ENV) env: Env) {
    super({
      adapter: new PrismaPg({
        connectionString: buildDatabaseUrl(env),
        max: env.POSTGRES_POOL_MAX,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma terhubung ke PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Koneksi Prisma ditutup');
  }
}
