import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Rate limiter fixed-window berbasis Redis.
 *
 * Dipakai endpoint publik yang tidak punya autentikasi, jadi satu-satunya
 * pembeda pemanggil adalah pasangan (formKey, IP) — lihat ARCHITECTURE.md
 * bagian 6 poin 4.
 *
 * Fixed window dipilih ketimbang sliding window karena cuma butuh satu INCR:
 * pada perbatasan window sebuah IP memang bisa mengirim hingga dua kali limit,
 * dan untuk melindungi form dari spam itu masih jauh dari masalah.
 */

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Detik sampai window berikutnya. Dikirim sebagai header `Retry-After`. */
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitVerdict> {
    try {
      const results = await this.redis.multi().incr(key).ttl(key).exec();
      const count = readNumber(results, 0);
      const ttl = readNumber(results, 1);

      if (count === null) throw new Error('Redis tidak mengembalikan hasil INCR');

      // TTL negatif berarti key baru dibuat (-1: tanpa expiry, -2: tidak ada).
      let remainingTtl = ttl ?? -1;

      if (remainingTtl < 0) {
        await this.redis.expire(key, windowSeconds);
        remainingTtl = windowSeconds;
      }

      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: remainingTtl,
      };
    } catch (error) {
      // Sengaja fail open. Redis yang bermasalah sebaiknya membuat form tetap
      // bisa diisi, bukan menolak semua orang — rate limit di sini melindungi
      // dari spam, bukan menjaga integritas data.
      this.logger.error(
        `Rate limit dilewati karena Redis bermasalah (${key}): ${error instanceof Error ? error.message : String(error)}`,
      );

      return { allowed: true, limit, remaining: limit, retryAfterSeconds: 0 };
    }
  }
}

/** `multi().exec()` mengembalikan [[error, value], ...] — nilainya diambil aman. */
function readNumber(results: [Error | null, unknown][] | null, index: number): number | null {
  const entry = results?.[index];

  if (!entry) return null;

  const [error, value] = entry;

  if (error) throw error;

  return typeof value === 'number' ? value : null;
}
