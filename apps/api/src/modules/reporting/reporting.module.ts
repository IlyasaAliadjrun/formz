import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ReportExportService } from './report-export.service';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

/**
 * Agregasi & ekspor laporan.
 *
 * Perhitungan beratnya tidak ada di sini melainkan di materialized view
 * PostgreSQL (migrasi `20260809160000_reporting_views`), yang di-refresh worker
 * lewat job berjadwal. Modul ini hanya membaca hasilnya, menerjemahkan id opsi
 * jadi label memakai schema form, dan menyusunnya jadi berkas .xlsx.
 */
@Module({
  imports: [QueueModule],
  controllers: [ReportingController],
  providers: [ReportingService, ReportExportService],
  exports: [ReportingService],
})
export class ReportingModule {}
