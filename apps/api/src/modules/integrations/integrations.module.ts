import { Module } from '@nestjs/common';

/**
 * Konfigurasi integrasi per form (Google Sheets target, penerima email notifikasi)
 * dan pembacaan submission_integration_logs untuk status sync/forward.
 * Eksekusi job-nya sendiri ada di apps/worker.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class IntegrationsModule {}
