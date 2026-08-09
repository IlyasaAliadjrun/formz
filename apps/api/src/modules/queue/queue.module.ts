import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { QUEUE_NAMES } from '@formz/shared';
import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env.schema';
import {
  EMAIL_NOTIFICATION_QUEUE,
  EMAIL_NOTIFICATION_QUEUE_EVENTS,
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
  exports: [QueueService, SubmissionDispatcherService, SHEET_SYNC_QUEUE, EMAIL_NOTIFICATION_QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueModule.name);

  constructor(
    @Inject(SHEET_SYNC_QUEUE) private readonly sheetQueue: Queue,
    @Inject(EMAIL_NOTIFICATION_QUEUE) private readonly emailQueue: Queue,
    @Inject(SHEET_SYNC_QUEUE_EVENTS) private readonly sheetEvents: QueueEvents,
    @Inject(EMAIL_NOTIFICATION_QUEUE_EVENTS) private readonly emailEvents: QueueEvents,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([
      this.sheetQueue.close(),
      this.emailQueue.close(),
      this.sheetEvents.close(),
      this.emailEvents.close(),
    ]);

    this.logger.log('Koneksi queue ditutup');
  }
}
