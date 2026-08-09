import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import {
  IntegrationsController,
  SubmissionIntegrationsController,
} from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/**
 * Konfigurasi integrasi per form (target Google Sheets, aturan notifikasi email)
 * dan tombol uji cobanya. Eksekusi job-nya sendiri ada di apps/worker — modul ini
 * hanya menulis konfigurasi dan mengantrekan pekerjaan.
 */
@Module({
  imports: [QueueModule],
  controllers: [IntegrationsController, SubmissionIntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
