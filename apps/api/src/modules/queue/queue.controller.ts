import { Controller, Get, Inject } from '@nestjs/common';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env.schema';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { QueueService, type QueueCounts } from './queue.service';

export interface QueueSummary {
  queues: QueueCounts[];
  /** Path Bull Board, atau null kalau kredensialnya belum diatur di server. */
  boardPath: string | null;
}

/**
 * Ringkasan antrean untuk dashboard. Bull Board sendiri adalah halaman terpisah
 * dengan autentikasinya sendiri (lihat `bull-board.ts`); endpoint ini ada supaya
 * admin bisa melihat ada tidaknya job gagal tanpa harus membukanya.
 */
@Controller('admin/queues')
export class QueueController {
  constructor(
    private readonly queue: QueueService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Get('summary')
  @RequirePermission('integration.manage')
  async summary(): Promise<QueueSummary> {
    return {
      queues: await this.queue.counts(),
      boardPath:
        this.env.QUEUE_DASHBOARD_USER && this.env.QUEUE_DASHBOARD_PASSWORD
          ? this.env.QUEUE_DASHBOARD_PATH
          : null,
    };
  }
}
