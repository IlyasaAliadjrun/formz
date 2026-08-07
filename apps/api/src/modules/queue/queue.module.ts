import { Module } from '@nestjs/common';

/**
 * Sisi producer BullMQ: mendorong job `sheet-sync` & `email-notification`
 * ke Redis. Consumer-nya berjalan di apps/worker sebagai proses terpisah.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class QueueModule {}
