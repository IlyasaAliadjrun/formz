import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env.schema';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';

/**
 * Cache versi terpublish sebuah form di Redis.
 *
 * Form yang di-embed bisa dimuat ribuan kali per hari sementara isinya nyaris
 * tidak pernah berubah — persis kasus yang disebut ARCHITECTURE.md bagian 3.4
 * ("cache schema form biar embed load cepat").
 *
 * Yang di-cache bukan hanya schema, tapi juga `allowedDomains` dan `status`,
 * karena keduanya dibutuhkan pemeriksaan CORS pada **setiap** request publik —
 * termasuk preflight OPTIONS yang tidak pernah sampai ke controller. Tanpa itu,
 * cache schema tidak ada gunanya: query database tetap jalan tiap request.
 */

/** Bentuk data yang disimpan di Redis. Sengaja datar supaya JSON-nya kecil. */
export interface CachedPublishedForm {
  formId: string;
  formKey: string;
  status: string;
  allowedDomains: string[];
  /** Null kalau form belum pernah dipublish — tetap di-cache supaya 404 juga cepat. */
  formVersionId: string | null;
  versionNumber: number | null;
  /**
   * Diangkat keluar dari schema supaya guard rate limit tidak perlu mem-parse
   * seluruh schema hanya untuk membaca satu angka.
   */
  rateLimitPerHour: number | null;
  /** Schema mentah dari JSONB; di-parse pemanggil dengan `formSchemaSchema`. */
  schema: unknown;
}

const KEY_PREFIX = 'form:public:';

@Injectable()
export class PublishedFormCacheService {
  private readonly logger = new Logger(PublishedFormCacheService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async get(formKey: string): Promise<CachedPublishedForm | null> {
    try {
      const raw = await this.redis.get(key(formKey));

      return raw ? (JSON.parse(raw) as CachedPublishedForm) : null;
    } catch (error) {
      // Redis mati tidak boleh membuat form ikut mati — pemanggil akan jatuh
      // kembali ke database.
      this.logger.warn(`Gagal membaca cache form ${formKey}: ${describe(error)}`);

      return null;
    }
  }

  async set(value: CachedPublishedForm): Promise<void> {
    try {
      await this.redis.set(
        key(value.formKey),
        JSON.stringify(value),
        'EX',
        this.env.PUBLIC_SCHEMA_CACHE_TTL,
      );
    } catch (error) {
      this.logger.warn(`Gagal menulis cache form ${value.formKey}: ${describe(error)}`);
    }
  }

  /**
   * Dipanggil setiap kali apa pun yang ikut di-cache berubah: publish, ubah
   * whitelist domain, arsip, dan hapus. Kalau ada satu jalur perubahan yang lupa
   * memanggil ini, form yang sudah diperbarui akan tetap tampil versi lama
   * sampai TTL habis.
   */
  async invalidate(formKey: string): Promise<void> {
    try {
      await this.redis.del(key(formKey));
      this.logger.debug(`Cache form ${formKey} dibatalkan`);
    } catch (error) {
      this.logger.warn(`Gagal membatalkan cache form ${formKey}: ${describe(error)}`);
    }
  }
}

function key(formKey: string): string {
  return `${KEY_PREFIX}${formKey}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
