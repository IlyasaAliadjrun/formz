import { Module } from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service';

/** Klien Redis-nya sendiri sudah global (RedisModule), jadi modul ini cukup tipis. */
@Module({
  providers: [RateLimiterService],
  exports: [RateLimiterService],
})
export class RateLimitModule {}
