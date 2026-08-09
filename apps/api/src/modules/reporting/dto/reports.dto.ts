import { reportGranularitySchema } from '@formz/shared';
import { z } from 'zod';

/**
 * Query string ditulis dashboard dengan camelCase, tapi dokumentasi API dan
 * pemakaian manual (curl, skrip) lebih lazim memakai snake_case. Keduanya
 * diterima, sama seperti di `/admin/submissions`.
 */
function withSnakeCaseAliases(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;

  const raw = value as Record<string, unknown>;

  return {
    ...raw,
    formId: raw.formId ?? raw.form_id,
    from: raw.from ?? raw.date_from ?? raw.dateFrom,
    to: raw.to ?? raw.date_to ?? raw.dateTo,
  };
}

/**
 * Batas rentang selalu berupa tanggal, bukan jam.
 *
 * Agregasinya memang per hari (lihat materialized view di migrasi
 * `20260809160000_reporting_views`), jadi `to=2026-08-09T13:00:00Z` tidak bisa
 * ditepati apa adanya — yang tersedia hanya seluruh hari itu. ISO lengkap tetap
 * diterima supaya pemanggil tidak perlu memformat ulang, tapi bagian jamnya
 * dipangkas di sini, terang-terangan, alih-alih diam-diam diabaikan di query.
 */
const dateBoundarySchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Tanggal tidak valid')
  .transform((value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toISOString().slice(0, 10),
  );

const baseShape = {
  formId: z.uuid('form_id harus berupa UUID form yang valid'),
  from: dateBoundarySchema.optional(),
  to: dateBoundarySchema.optional(),
  granularity: reportGranularitySchema.default('day'),
};

/** Rentang terbalik hampir selalu salah ketik, dan hasilnya selalu kosong. */
const orderedRange = <T extends { from?: string; to?: string }>(value: T, ctx: z.RefinementCtx) => {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: 'Tanggal awal tidak boleh setelah tanggal akhir',
    });
  }
};

export const reportOverviewSchema = z.preprocess(
  withSnakeCaseAliases,
  z.object(baseShape).superRefine(orderedRange),
);
export type ReportOverviewDto = z.infer<typeof reportOverviewSchema>;

/**
 * Hanya .xlsx. Laporan terdiri dari empat bagian yang bentuknya berbeda
 * (ringkasan, tren, status integrasi, distribusi jawaban); memaksanya jadi satu
 * berkas CSV berarti memilih salah satunya dan membuang tiga sisanya. Ekspor
 * baris mentah per submission — yang memang cocok untuk CSV — sudah tersedia di
 * `/admin/submissions/export`.
 */
export const exportReportSchema = z.preprocess(
  withSnakeCaseAliases,
  z.object(baseShape).superRefine(orderedRange),
);
export type ExportReportDto = z.infer<typeof exportReportSchema>;
