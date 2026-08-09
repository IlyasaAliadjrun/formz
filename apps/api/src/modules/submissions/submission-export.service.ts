import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
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
  /** True kalau hasil dipotong batas baris — dipakai controller untuk header peringatan. */
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
      formatTimestamp(row.submittedAt),
      `v${row.versionNumber}`,
      row.sourceDomain ?? '',
      ...data.columns.map((column) => row.values[column.fieldId] ?? ''),
    ]);

    this.logger.log(
      `Ekspor ${rows.length} submission form "${data.form.title}" sebagai ${query.format}`,
    );

    const filename = buildFilename(data.form.title, query.format);

    return {
      filename,
      truncated: data.truncated,
      rowCount: rows.length,
      ...(query.format === 'csv'
        ? { contentType: 'text/csv; charset=utf-8', body: toCsv(headers, rows) }
        : {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            body: await toXlsx(data.form.title, headers, rows),
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

async function toXlsx(title: string, headers: string[], rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName(title));

  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  // Baris header ikut tergulir bersama isi kalau tidak dibekukan, dan tabel
  // submission hampir selalu lebih panjang dari satu layar.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) {
    sheet.addRow(row);
  }

  sheet.columns.forEach((column, index) => {
    const longest = rows.reduce(
      (max, row) => Math.max(max, (row[index] ?? '').length),
      (headers[index] ?? '').length,
    );

    // Dibatasi supaya satu jawaban panjang tidak membuat kolomnya selebar layar.
    column.width = Math.min(50, Math.max(12, longest + 2));
  });

  // ExcelJS mengembalikan ArrayBuffer-like; Buffer.from menyeragamkannya.
  return Buffer.from(await workbook.xlsx.writeBuffer());
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

/** `2026-08-09 14:30:05` dalam waktu server, konsisten untuk semua baris. */
function formatTimestamp(value: Date): string {
  return value.toISOString().replace('T', ' ').slice(0, 19);
}

/** Excel menolak nama sheet berisi : \ / ? * [ ] dan lebih dari 31 karakter. */
function sheetName(title: string): string {
  const cleaned = title.replace(/[:\\/?*[\]]/g, ' ').trim();

  return cleaned.slice(0, 31) || 'Submission';
}

function buildFilename(title: string, format: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'submission';

  const stamp = new Date().toISOString().slice(0, 10);

  return `${slug}-${stamp}.${format}`;
}
