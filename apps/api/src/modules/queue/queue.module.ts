import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { JOB_NAMES, QUEUE_NAMES, REPORT_REFRESH_SCHEDULER_ID } from '@formz/shared';
import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env.schema';
import {
  EMAIL_NOTIFICATION_QUEUE,
  EMAIL_NOTIFICATION_QUEUE_EVENTS,
  REPORT_REFRESH_QUEUE,
  SHEET_SYNC_QUEUE,
  SHEET_SYNC_QUEUE_EVENTS,
} from './queue.constants';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { SubmissionDispatcherService } from './submission-dispatcher.service';

/**
 * Sisi producer BullMQ: mendorong job `sync-to-sheet` & `send-notification`
 * ke Redis. Consumer-nya berjalan di apps/worker sebagai proses terpisah —
 * itulah yang membuat submit form tetap cepat walau Google API sedang lambat
 * (ARCHITECTURE.md bagian 3.5).
 *
 * Koneksi Redis-nya sengaja **tidak** memakai `REDIS_CLIENT` yang dipakai cache.
 * BullMQ membuat koneksi tambahan sendiri untuk perintah blocking, dan lebih
 * aman membiarkannya mengelola siklus hidup koneksinya sendiri daripada berbagi
 * satu klien dengan cache dan rate limiter.
 */
function connectionOptions(env: Env): ConnectionOptions {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    db: env.REDIS_DB,
    // Wajib null untuk BullMQ: perintah blocking tidak boleh di-timeout klien.
    maxRetriesPerRequest: null,
  };
}

@Global()
@Module({
  controllers: [QueueController],
  providers: [
    {
      provide: SHEET_SYNC_QUEUE,
      inject: [APP_ENV],
      useFactory: (env: Env) =>
        new Queue(QUEUE_NAMES.SHEET_SYNC, { connection: connectionOptions(env) }),
    },
    {
      provide: EMAIL_NOTIFICATION_QUEUE,
      inject: [APP_ENV],
      useFactory: (env: Env) =>
        new Queue(QUEUE_NAMES.EMAIL_NOTIFICATION, { connection: connectionOptions(env) }),
    },
    {
      provide: REPORT_REFRESH_QUEUE,
      inject: [APP_ENV],
      useFactory: (env: Env) =>
        new Queue(QUEUE_NAMES.REPORT_REFRESH, { connection: connectionOptions(env) }),
    },
    {
      provide: SHEET_SYNC_QUEUE_EVENTS,
      inject: [APP_ENV],
      useFactory: (env: Env) =>
        new QueueEvents(QUEUE_NAMES.SHEET_SYNC, { connection: connectionOptions(env) }),
    },
    {
      provide: EMAIL_NOTIFICATION_QUEUE_EVENTS,
      inject: [APP_ENV],
      useFactory: (env: Env) =>
        new QueueEvents(QUEUE_NAMES.EMAIL_NOTIFICATION, { connection: connectionOptions(env) }),
    },
    QueueService,
    SubmissionDispatcherService,
  ],
  exports: [
    QueueService,
    SubmissionDispatcherService,
    SHEET_SYNC_QUEUE,
    EMAIL_NOTIFICATION_QUEUE,
    REPORT_REFRESH_QUEUE,
  ],
})
export class QueueModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueModule.name);

  constructor(
    @Inject(SHEET_SYNC_QUEUE) private readonly sheetQueue: Queue,
    @Inject(EMAIL_NOTIFICATION_QUEUE) private readonly emailQueue: Queue,
    @Inject(REPORT_REFRESH_QUEUE) private readonly reportQueue: Queue,
    @Inject(SHEET_SYNC_QUEUE_EVENTS) private readonly sheetEvents: QueueEvents,
    @Inject(EMAIL_NOTIFICATION_QUEUE_EVENTS) private readonly emailEvents: QueueEvents,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /**
   * Mendaftarkan jadwal refresh laporan.
   *
   * `upsertJobScheduler` dipilih alih-alih cron di sistem operasi atau
   * `@nestjs/schedule` karena tiga hal: jadwalnya tersimpan di Redis sehingga
   * beberapa instance API tidak menghasilkan job kembar, pekerjaannya jatuh ke
   * worker (tempat pekerjaan berat memang berada), dan riwayat tiap
   * penjalanannya ikut terlihat di Bull Board bersama job lain.
   *
   * Sifatnya upsert: mengubah `REPORT_REFRESH_CRON` lalu restart sudah cukup
   * untuk mengganti jadwal — tidak ada jadwal lama yang tertinggal di Redis.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.reportQueue.upsertJobScheduler(
        REPORT_REFRESH_SCHEDULER_ID,
        { pattern: this.env.REPORT_REFRESH_CRON },
        { name: JOB_NAMES.REFRESH_REPORTS, data: { reason: 'scheduled' } },
      );

      this.logger.log(`Refresh laporan dijadwalkan: ${this.env.REPORT_REFRESH_CRON}`);
    } catch (error) {
      // Pola cron yang ditolak parser tidak boleh menggagalkan boot seluruh API —
      // laporannya jadi tidak pernah segar, dan itu yang perlu terbaca di log.
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Gagal menjadwalkan refresh laporan (${this.env.REPORT_REFRESH_CRON}): ${message}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([
      this.sheetQueue.close(),
      this.emailQueue.close(),
      this.reportQueue.close(),
      this.sheetEvents.close(),
      this.emailEvents.close(),
    ]);

    this.logger.log('Koneksi queue ditutup');
  }
}
