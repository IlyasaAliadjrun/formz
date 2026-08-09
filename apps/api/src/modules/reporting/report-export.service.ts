import { Injectable, Logger } from '@nestjs/common';
import type { ReportIntegrationStat, ReportOverview } from '@formz/shared';
import { buildWorkbook, exportFilename, type SheetSpec } from '../../common/xlsx';
import type { ExportReportDto } from './dto/reports.dto';
import { ReportingService } from './reporting.service';

/**
 * Ekspor laporan ke .xlsx.
 *
 * Isinya persis angka yang sama dengan yang tampil di halaman laporan — dibaca
 * dari `ReportingService.overview()` yang sama, bukan dari query terpisah.
 * Laporan di layar dan laporan di berkas karena itu tidak bisa berbeda, dan
 * berkas yang diekspor pun ikut membawa keterangan "data per kapan" seperti di
 * layar, karena angka agregat tanpa tanggal perhitungan gampang sekali dikutip
 * sebagai kondisi terkini padahal bukan.
 */

export interface ReportExportResult {
  filename: string;
  contentType: string;
  body: Buffer;
}

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);

  constructor(private readonly reporting: ReportingService) {}

  async export(query: ExportReportDto): Promise<ReportExportResult> {
    const report = await this.reporting.overview(query);

    this.logger.log(
      `Ekspor laporan form "${report.form.title}" (${report.totals.submissions} submission)`,
    );

    return {
      filename: exportFilename(['laporan', report.form.title], 'xlsx'),
      contentType: XLSX_CONTENT_TYPE,
      body: await buildWorkbook(buildSheets(report)),
    };
  }
}

function buildSheets(report: ReportOverview): SheetSpec[] {
  return [
    ringkasanSheet(report),
    trenSheet(report),
    integrasiSheet(report),
    distribusiSheet(report),
  ];
}

function ringkasanSheet(report: ReportOverview): SheetSpec {
  return {
    name: 'Ringkasan',
    headers: ['Keterangan', 'Nilai'],
    rows: [
      ['Form', report.form.title],
      ['Status form', report.form.status],
      ['Periode mulai', report.range.from ?? 'Seluruh waktu'],
      ['Periode selesai', report.range.to ?? 'Seluruh waktu'],
      ['Pengelompokan tren', report.range.granularity === 'week' ? 'Mingguan' : 'Harian'],
      ['Total submission', report.totals.submissions],
      ['Hari aktif', report.totals.activeDays],
      ['Rata-rata per hari aktif', report.totals.averagePerActiveDay],
      ['Submission pertama', formatStamp(report.totals.firstSubmissionAt)],
      ['Submission terakhir', formatStamp(report.totals.lastSubmissionAt)],
      ['Data dihitung pada', formatStamp(report.freshness.refreshedAt)],
      ['Submission belum terhitung', report.freshness.pendingSubmissions],
    ],
  };
}

function trenSheet(report: ReportOverview): SheetSpec {
  return {
    name: 'Tren',
    headers: [report.range.granularity === 'week' ? 'Minggu (mulai)' : 'Tanggal', 'Submission'],
    rows: report.trend.map((point) => [point.bucket, point.count]),
  };
}

function integrasiSheet(report: ReportOverview): SheetSpec {
  return {
    name: 'Status Integrasi',
    headers: ['Integrasi', 'Total catatan', 'Sukses', 'Gagal', 'Menunggu', 'Tingkat sukses (%)'],
    rows: [
      statRow('Spreadsheet', report.integrations.sheet),
      statRow('Email', report.integrations.email),
    ],
  };
}

function statRow(label: string, stat: ReportIntegrationStat): Array<string | number> {
  return [
    label,
    stat.total,
    stat.success,
    stat.failed,
    stat.pending,
    // Tanda hubung, bukan 0: belum ada catatan sama sekali bukan berarti 0% sukses.
    stat.successRate ?? '—',
  ];
}

function distribusiSheet(report: ReportOverview): SheetSpec {
  const rows: Array<Array<string | number>> = [];

  for (const distribution of report.distributions) {
    for (const option of distribution.options) {
      rows.push([
        distribution.label,
        option.label,
        option.count,
        distribution.respondents,
        option.percentage,
        option.orphan ? 'Opsi sudah dihapus dari form' : '',
      ]);
    }
  }

  return {
    name: 'Distribusi Jawaban',
    headers: ['Field', 'Opsi', 'Jumlah', 'Penjawab', 'Persentase (%)', 'Catatan'],
    rows,
  };
}

/** `2026-08-09 14:30:05` dalam waktu server, konsisten untuk semua baris. */
function formatStamp(value: string | null): string {
  return value ? value.replace('T', ' ').slice(0, 19) : '—';
}
