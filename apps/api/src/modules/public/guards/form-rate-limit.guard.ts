import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env.schema';
import {
  RateLimiterService,
  type RateLimitVerdict,
} from '../../../infrastructure/rate-limit/rate-limiter.service';
import { PublicFormsService } from '../public-forms.service';
import { readFormKey } from './form-origin.guard';

/**
 * Rate limit per (formKey, IP) untuk endpoint publik — ARCHITECTURE.md bagian 6 poin 4.
 *
 * Ada dua lapis dengan tujuan berbeda:
 *
 * 1. **Burst per menit** (`PUBLIC_RATE_LIMIT_PER_MINUTE`) berlaku untuk semua
 *    endpoint publik, termasuk pengambilan schema. Ini yang menahan orang
 *    menembaki endpoint dengan formKey acak.
 * 2. **Kuota submit per jam**, diambil dari `settings.rateLimitPerHour` milik
 *    form itu sendiri. Pemilik form yang menentukan, karena wajarnya berbeda
 *    jauh antara form pendaftaran acara dan form kontak biasa.
 */
@Injectable()
export class FormRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimiter: RateLimiterService,
    private readonly publicForms: PublicFormsService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const formKey = readFormKey(request);

    if (!formKey) return true;

    const ip = clientIp(request);

    const burst = await this.rateLimiter.consume(
      `rl:public:${formKey}:${ip}`,
      this.env.PUBLIC_RATE_LIMIT_PER_MINUTE,
      60,
    );

    applyHeaders(response, burst);

    if (!burst.allowed) {
      throw tooManyRequests(burst, 'Terlalu banyak permintaan. Coba lagi sebentar lagi.');
    }

    if (request.method !== 'POST') return true;

    const form = await this.publicForms.resolve(formKey);
    const perHour = form?.rateLimitPerHour;

    if (!perHour) return true;

    const quota = await this.rateLimiter.consume(`rl:submit:${formKey}:${ip}`, perHour, 3_600);

    applyHeaders(response, quota);

    if (!quota.allowed) {
      throw tooManyRequests(
        quota,
        'Batas pengiriman untuk form ini sudah tercapai. Coba lagi nanti.',
      );
    }

    return true;
  }
}

/**
 * `request.ip` mengikuti pengaturan `trust proxy` Express, yang di `main.ts`
 * hanya dinyalakan kalau `TRUST_PROXY=true`. Tanpa itu header `X-Forwarded-For`
 * diabaikan — kalau tidak, siapa pun bisa mengaku ber-IP lain dan lolos limit.
 */
function clientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

function applyHeaders(response: Response, verdict: RateLimitVerdict): void {
  response.setHeader('X-RateLimit-Limit', String(verdict.limit));
  response.setHeader('X-RateLimit-Remaining', String(verdict.remaining));

  if (!verdict.allowed) {
    response.setHeader('Retry-After', String(Math.max(1, verdict.retryAfterSeconds)));
  }
}

function tooManyRequests(verdict: RateLimitVerdict, message: string): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message,
      retryAfterSeconds: verdict.retryAfterSeconds,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
