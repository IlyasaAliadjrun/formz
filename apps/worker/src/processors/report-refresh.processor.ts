import {
  REPORT_VIEWS,
  reportRefreshJobSchema,
  type ReportRefreshJob,
  type ReportRefreshResult,
} from '@formz/shared';
import type { Job } from 'bullmq';
import {
  recordRefreshFailure,
  recordRefreshSuccess,
  refreshReportView,
} from '../db/report-queries';
import { createLogger } from '../logger';

const logger = createLogger('report-refresh');

/**
 * Menghitung ulang seluruh materialized view laporan.
 *
 * Dijalankan dua cara: dijadwalkan lewat job scheduler BullMQ yang didaftarkan
 * API saat boot (`REPORT_REFRESH_CRON`), dan atas permintaan dari tombol
 * "Perbarui data" di halaman laporan. Keduanya jatuh ke fungsi yang sama.
 *
 * View di-refresh **berurutan**, bukan paralel. Keempatnya memindai tabel
 * `submissions` yang sama, dan menjalankannya bersamaan hanya membuat mereka
 * berebut I/O yang sama sambil memperpanjang waktu total — sementara tidak ada
 * yang menunggu hasilnya secara sinkron.
 *
 * Kegagalan satu view **tidak** menghentikan yang lain. Laporan yang tiga per
 * empat bagiannya segar lebih berguna daripada laporan yang seluruhnya basi
 * karena satu view bermasalah, dan bagian yang gagal tetap terlihat lewat
 * `report_refresh_state.error_message` yang ikut ditampilkan di layar.
 */
export async function processReportRefresh(
  job: Job<ReportRefreshJob>,
): Promise<ReportRefreshResult> {
  const payload = reportRefreshJobSchema.parse(job.data ?? {});
  const started = Date.now();
  const views: ReportRefreshResult['views'] = [];
  const failures: string[] = [];

  for (const view of REPORT_VIEWS) {
    try {
      const result = await refreshReportView(view);

      await recordRefreshSuccess(result);
      views.push({ name: result.name, durationMs: result.durationMs, rowCount: result.rowCount });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await recordRefreshFailure(view, message);
      failures.push(`${view}: ${message}`);
      logger.error(`Gagal me-refresh ${view}: ${message}`);
    }
  }

  const totalMs = Date.now() - started;

  if (failures.length > 0) {
    // Dilempar setelah semuanya dicoba, supaya job-nya terlihat merah di Bull
    // Board dan pesan gabungannya terbaca di satu tempat.
    throw new Error(`${failures.length} view gagal di-refresh — ${failures.join('; ')}`);
  }

  logger.info(
    `Refresh laporan (${payload.reason}) selesai dalam ${totalMs} ms: ` +
      views.map((view) => `${view.name} ${view.rowCount} baris`).join(', '),
  );

  return { views, totalMs };
}
