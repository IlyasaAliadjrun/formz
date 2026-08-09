import { Module } from '@nestjs/common';
import { SubmissionExportService } from './submission-export.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

/**
 * Pembacaan submission dari dashboard (/admin/submissions).
 *
 * Penerimaan submit publik tinggal di PublicModule, bukan di sini — dua sisi itu
 * sengaja tidak berbagi controller supaya tidak ada jalur dari form yang
 * di-embed ke data submission milik orang lain.
 */
@Module({
  controllers: [SubmissionsController],
  providers: [SubmissionsService, SubmissionExportService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
