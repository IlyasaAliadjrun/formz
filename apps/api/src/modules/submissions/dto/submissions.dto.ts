import { z } from 'zod';

/**
 * Query string ditulis dashboard dengan camelCase, tapi dokumentasi API dan
 * pemakaian manual (curl, skrip) lebih lazim memakai snake_case. Keduanya
 * diterima supaya tidak ada yang perlu menghafal ejaan mana yang benar.
 */
function withSnakeCaseAliases(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;

  const raw = value as Record<string, unknown>;

  return {
    ...raw,
    formId: raw.formId ?? raw.form_id,
    perPage: raw.perPage ?? raw.per_page,
    from: raw.from ?? raw.date_from ?? raw.dateFrom,
    to: raw.to ?? raw.date_to ?? raw.dateTo,
  };
}

/**
 * Batas tanggal boleh berupa `YYYY-MM-DD` atau ISO 8601 lengkap. Bentuk pendek
 * dilebarkan jadi rentang sehari penuh di service — kalau tidak, `to=2026-08-09`
 * akan berarti tepat tengah malam dan submission sepanjang hari itu ikut hilang.
 */
const dateBoundarySchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Tanggal tidak valid');

/**
 * Belum ada pencarian teks bebas di sini. Isi jawaban tersimpan sebagai JSONB,
 * dan mencarinya butuh `answers::text ILIKE` lewat SQL mentah plus index trigram
 * supaya tidak memindai seluruh tabel — pekerjaan yang lebih pas digabung dengan
 * agregasi di Part 9. Filter yang tersedia sekarang: form dan rentang tanggal.
 */
const baseFilterShape = {
  formId: z.uuid('form_id harus berupa UUID form yang valid'),
  from: dateBoundarySchema.optional(),
  to: dateBoundarySchema.optional(),
};

/** Rentang terbalik hampir selalu salah ketik, dan hasilnya selalu kosong. */
const orderedRange = <T extends { from?: string; to?: string }>(value: T, ctx: z.RefinementCtx) => {
  if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: 'Tanggal awal tidak boleh setelah tanggal akhir',
    });
  }
};

export const listSubmissionsSchema = z.preprocess(
  withSnakeCaseAliases,
  z
    .object({
      ...baseFilterShape,
      page: z.coerce.number().int().positive().default(1),
      perPage: z.coerce.number().int().positive().max(100).default(25),
    })
    .superRefine(orderedRange),
);
export type ListSubmissionsDto = z.infer<typeof listSubmissionsSchema>;

export const exportSubmissionsSchema = z.preprocess(
  withSnakeCaseAliases,
  z
    .object({
      ...baseFilterShape,
      format: z.enum(['xlsx', 'csv']).default('xlsx'),
    })
    .superRefine(orderedRange),
);
export type ExportSubmissionsDto = z.infer<typeof exportSubmissionsSchema>;
