import { Module } from '@nestjs/common';

/**
 * Penerimaan submit publik + pembacaan submission dari dashboard.
 * Rencana isi: SubmissionsController (admin), PublicSubmitController (embed),
 * SubmissionsService, dan enqueue job sync sheet/email ke BullMQ.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class SubmissionsModule {}
