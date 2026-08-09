import ExcelJS from 'exceljs';

/**
 * Penyusunan berkas .xlsx (ExcelJS, sesuai ARCHITECTURE.md bagian 3.6).
 *
 * Dipakai dua modul: ekspor submission (satu sheet berisi seluruh jawaban) dan
 * ekspor laporan (beberapa sheet berisi angka agregat). Aturan kecil seperti
 * "nama sheet Excel maksimal 31 karakter" dan "lebar kolom dibatasi" tidak
 * layak ditulis dua kali — yang kedua pasti tertinggal saat yang pertama
 * diperbaiki.
 */

export type CellValue = string | number;

export interface SheetSpec {
  name: string;
  headers: string[];
  rows: CellValue[][];
}

/** Lebar kolom maksimum, supaya satu jawaban panjang tidak selebar layar. */
const MAX_COLUMN_WIDTH = 50;
const MIN_COLUMN_WIDTH = 12;

export async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(excelSheetName(spec.name));

    sheet.addRow(spec.headers);
    sheet.getRow(1).font = { bold: true };
    // Baris header ikut tergulir bersama isi kalau tidak dibekukan, dan tabel
    // hasil ekspor hampir selalu lebih panjang dari satu layar.
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const row of spec.rows) {
      sheet.addRow(row);
    }

    sheet.columns.forEach((column, index) => {
      const longest = spec.rows.reduce(
        (max, row) => Math.max(max, String(row[index] ?? '').length),
        (spec.headers[index] ?? '').length,
      );

      column.width = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest + 2));
    });
  }

  // ExcelJS mengembalikan ArrayBuffer-like; Buffer.from menyeragamkannya.
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Excel menolak nama sheet berisi : \ / ? * [ ] dan lebih dari 31 karakter. */
export function excelSheetName(title: string): string {
  const cleaned = title.replace(/[:\\/?*[\]]/g, ' ').trim();

  return cleaned.slice(0, 31) || 'Sheet1';
}

/** `laporan-formulir-pendaftaran-2026-08-09.xlsx` */
export function exportFilename(parts: string[], format: string): string {
  const slug =
    parts
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'ekspor';

  const stamp = new Date().toISOString().slice(0, 10);

  return `${slug}-${stamp}.${format}`;
}

/** `2026-08-09 14:30:05` dalam waktu server, konsisten untuk semua baris. */
export function formatExportTimestamp(value: Date): string {
  return value.toISOString().replace('T', ' ').slice(0, 19);
}
