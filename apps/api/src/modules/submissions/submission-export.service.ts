import { Injectable, Logger } from '@nestjs/common';
import { buildWorkbook, exportFilename, formatExportTimestamp } from '../../common/xlsx';
import type { ExportSubmissionsDto } from './dto/submissions.dto';
import { SubmissionsService, type SubmissionColumn } from './submissions.service';

/**
 * Ekspor submission ke .xlsx (ExcelJS, sesuai ARCHITECTURE.md bagian 3.6) dan .csv.
 *
 * Isi berkasnya memakai teks hasil `describeAnswers` dari `@formz/shared` —
 * sama persis dengan yang tampil di halaman detail. Jadi kolom "Jenis Layanan"
 * berisi "Implementasi", bukan `opt_2`, dan tidak mungkin berbeda antara layar
 * dan berkas karena keduanya memanggil fungsi yang sama.
 *
 * `ip_address` sengaja **tidak** diikutkan. Berkas ekspor gampang berpindah
 * tangan lewat email dan chat; alamat IP pengisi form tidak dibutuhkan untuk
 * pekerjaan yang biasa dilakukan dengan berkas ini, dan tetap bisa dilihat di
 * halaman detail oleh yang memang berhak.
 */

export interface ExportResult {
  filename: string;
  contentType: string;
  body: Buffer;
  /** True kalau hasil dipotong batas baris ekspor — dipakai controller untuk header peringatan. */
  truncated: boolean;
  rowCount: number;
}

/** Kolom tetap yang selalu ada di depan, sebelum kolom jawaban. */
const META_HEADERS = ['ID Submission', 'Waktu Submit', 'Versi Form', 'Domain Sumber'];

@Injectable()
export class SubmissionExportService {
  private readonly logger = new Logger(SubmissionExportService.name);

  constructor(private readonly submissions: SubmissionsService) {}

  async export(query: ExportSubmissionsDto): Promise<ExportResult> {
    const data = await this.submissions.collectForExport(query);
    const headers = [...META_HEADERS, ...data.columns.map(headerLabel)];
    const rows = data.rows.map((row) => [
      row.id,
      formatExportTimestamp(row.submittedAt),
      `v${row.versionNumber}`,
      row.sourceDomain ?? '',
      ...data.columns.map((column) => row.values[column.fieldId] ?? ''),
    ]);

    this.logger.log(
      `Ekspor ${rows.length} submission form "${data.form.title}" sebagai ${query.format}`,
    );

    const filename = exportFilename([data.form.title], query.format);

    return {
      filename,
      truncated: data.truncated,
      rowCount: rows.length,
      ...(query.format === 'csv'
        ? { contentType: 'text/csv; charset=utf-8', body: toCsv(headers, rows) }
        : {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            body: await buildWorkbook([{ name: data.form.title, headers, rows }]),
          }),
    };
  }
}

/**
 * Header memakai label field, tapi dua field boleh punya label sama sementara
 * `name`-nya dijamin unik. Nama ikut ditulis dalam kurung supaya kolom kembar
 * masih bisa dibedakan saat berkasnya diolah lebih lanjut.
 */
function headerLabel(column: SubmissionColumn): string {
  return column.label === column.name ? column.label : `${column.label} (${column.name})`;
}

function toCsv(headers: string[], rows: string[][]): Buffer {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsv).join(','));

  // BOM UTF-8: tanpa ini Excel di Windows membaca "é" dan "—" sebagai karakter
  // acak saat membuka CSV, dan itu keluhan pertama yang selalu muncul.
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

function escapeCsv(value: string): string {
  // Sel yang diawali =, +, -, atau @ dieksekusi sebagai rumus oleh Excel. Diberi
  // kutip tunggal di depan supaya isi kiriman orang lain tidak pernah jadi rumus
  // yang berjalan di komputer yang membukanya.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
