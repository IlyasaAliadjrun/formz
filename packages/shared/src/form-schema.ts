import { z } from 'zod';
import { conditionsSchema } from './conditions';
import { fieldTypeSchema } from './field-types';

/** Versi struktur schema form. Dinaikkan kalau ada perubahan breaking. */
export const FORM_SCHEMA_VERSION = 1;

export const fieldOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  /** Nilai yang disimpan ke submission; default-nya pakai `id` kalau tidak diisi. */
  value: z.string().optional(),
  /** Kondisi show/hide sampai level opsi (lihat ARCHITECTURE.md bagian 3.4). */
  conditions: conditionsSchema.optional(),
});
export type FieldOption = z.infer<typeof fieldOptionSchema>;

export const fieldValidationSchema = z.object({
  required: z.boolean().default(false),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  /** Khusus field file: satuan byte & daftar MIME type yang diizinkan. */
  maxFileSize: z.number().int().positive().optional(),
  allowedMimeTypes: z.array(z.string()).optional(),
  /** Pesan error kustom yang ditampilkan di form renderer. */
  errorMessage: z.string().optional(),
});
export type FieldValidation = z.infer<typeof fieldValidationSchema>;

export const formFieldSchema = z.object({
  id: z.string().min(1),
  type: fieldTypeSchema,
  /** Key yang dipakai sebagai kolom di jawaban & header spreadsheet. */
  name: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  defaultValue: z.unknown().optional(),
  options: z.array(fieldOptionSchema).optional(),
  validation: fieldValidationSchema.optional(),
  conditions: conditionsSchema.optional(),
  /** Metadata bebas untuk kebutuhan UI builder (lebar kolom, ikon, dll). */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formPageSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(formFieldSchema).default([]),
});
export type FormPage = z.infer<typeof formPageSchema>;

export const formSettingsSchema = z.object({
  submitButtonLabel: z.string().default('Kirim'),
  successMessage: z.string().default('Terima kasih, jawaban kamu sudah tersimpan.'),
  redirectUrl: z.url().optional(),
  /** Domain yang boleh meng-embed form ini (lihat ARCHITECTURE.md bagian 3.2). */
  allowedOrigins: z.array(z.string()).default([]),
  /** Batas submit per IP per jam untuk endpoint publik. */
  rateLimitPerHour: z.number().int().positive().default(60),
  requireCaptcha: z.boolean().default(false),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

export const formSchemaSchema = z.object({
  version: z.literal(FORM_SCHEMA_VERSION),
  title: z.string().min(1),
  description: z.string().optional(),
  pages: z.array(formPageSchema).min(1),
  settings: formSettingsSchema,
});
export type FormSchema = z.infer<typeof formSchemaSchema>;

export const formStatusSchema = z.enum(['draft', 'published', 'archived']);
export type FormStatus = z.infer<typeof formStatusSchema>;

/**
 * Bentuk data form yang dikirim ke form renderer (embed).
 * Hanya berisi data yang memang perlu ditampilkan ke pengisi form — tidak ada
 * info internal seperti email tujuan notifikasi atau nama sheet target.
 */
export const publicFormSchema = z.object({
  formKey: z.string().min(1),
  schemaVersionId: z.string().min(1),
  status: formStatusSchema,
  schema: formSchemaSchema,
});
export type PublicForm = z.infer<typeof publicFormSchema>;

/** Helper: ambil semua field dari seluruh halaman form. */
export function flattenFields(schema: FormSchema): FormField[] {
  return schema.pages.flatMap((page) => page.fields);
}
