import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { HealthResponse } from '@formz/shared';
import type { Response } from 'express';
import { Public } from '../modules/auth/decorators/public.decorator';
import { HealthService } from './health.service';

// Health check dipakai oleh Docker healthcheck & monitoring, jadi tidak boleh
// butuh token. Isinya hanya status koneksi, tidak ada data bisnis.
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * GET /health
   * 200 kalau Postgres & Redis dua-duanya terhubung, 503 kalau ada yang down.
   * Status per dependency tetap dikembalikan di body pada kedua kasus.
   */
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = await this.healthService.check();

    res.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return result;
  }

  /** Probe ringan tanpa menyentuh dependency — untuk healthcheck container. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
