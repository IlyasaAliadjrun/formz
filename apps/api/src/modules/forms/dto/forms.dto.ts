import { formSchemaSchema, formStatusSchema } from '@formz/shared';
import { z } from 'zod';

export const listFormsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(25),
  status: formStatusSchema.optional(),
  /** Pencarian pada judul form. */
  search: z.string().trim().min(1).max(255).optional(),
});
export type ListFormsDto = z.infer<typeof listFormsSchema>;

export const createFormSchema = z.object({
  title: z.string().trim().min(1, 'Judul form wajib diisi').max(255),
  description: z.string().trim().max(2000).optional(),
});
export type CreateFormDto = z.infer<typeof createFormSchema>;

/**
 * Update draft. `schema` diterima utuh (bukan patch per field) karena builder
 * memang mengirim seluruh susunan field setiap kali menyimpan — itu juga yang
 * membuat penghapusan dan pengurutan ulang field jadi sederhana.
 */
export const updateFormSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(2000).optional(),
    schema: formSchemaSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Tidak ada perubahan yang dikirim' });
export type UpdateFormDto = z.infer<typeof updateFormSchema>;

export const embedSettingsSchema = z.object({
  /**
   * Daftar domain yang boleh meng-embed form ini. Array kosong = tanpa batasan.
   * Disimpan sebagai hostname saja (tanpa skema/path) supaya pencocokan
   * header Origin nanti tidak ambigu.
   */
  allowedDomains: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(253)
        .transform((value) => normalizeDomain(value))
        .refine((value) => DOMAIN_PATTERN.test(value), {
          message: 'Domain tidak valid. Contoh yang benar: example.com atau app.example.com',
        }),
    )
    .max(50, 'Maksimal 50 domain per form'),
});
export type EmbedSettingsDto = z.infer<typeof embedSettingsSchema>;

/** Mengizinkan wildcard satu tingkat (*.example.com) dan localhost dengan port. */
const DOMAIN_PATTERN =
  /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?(:\d{1,5})?$/;

/** Membuang skema, path, dan trailing dot supaya yang tersimpan konsisten. */
function normalizeDomain(input: string): string {
  let value = input.trim().toLowerCase();

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0] ?? value;
  value = value.replace(/\.$/, '');

  return value;
}

export const publishFormSchema = z
  .object({
    /** Kalau true, peringatan (misal referensi field ke bawah) tidak menghalangi publish. */
    ignoreWarnings: z.boolean().default(true),
  })
  .default({ ignoreWarnings: true });
export type PublishFormDto = z.infer<typeof publishFormSchema>;
