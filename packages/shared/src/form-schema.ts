import { z } from 'zod';
import { conditionsSchema } from './conditions';

/**
 * Struktur JSON schema form yang disimpan di kolom JSONB `form_versions.schema`.
 *
 * Urutan field ditentukan oleh urutan array `fields` — tidak ada kolom `order`
 * terpisah, supaya tidak pernah ada dua sumber kebenaran yang bisa menyimpang.
 * Pembagian form menjadi beberapa bagian dilakukan lewat field bertipe
 * `section_heading`, bukan struktur halaman bersarang.
 */

/** Versi struktur schema. Dinaikkan kalau ada perubahan yang tidak kompatibel. */
export const FORM_SCHEMA_VERSION = 1;

/**
 * Nama field yang dipakai sebagai key jawaban di ekspor dan header spreadsheet.
 * Dibatasi pola aman supaya bisa dipakai langsung sebagai nama kolom.
 */
const fieldNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_]*$/i,
    'Nama field harus diawali huruf dan hanya boleh berisi huruf, angka, dan garis bawah',
  );

const fieldIdSchema = z.string().min(1).max(64);

// ---------------------------------------------------------------------------
// Opsi (untuk select / multiselect / radio)
// ---------------------------------------------------------------------------

export const fieldOptionSchema = z.object({
  /** Id unik di dalam field-nya. Rule kondisi menunjuk ke id ini, bukan ke label. */
  id: fieldIdSchema,
  label: z.string().min(1),
  /**
   * Nilai yang disimpan ke submission. Kalau kosong, `id` yang dipakai.
   * Berguna kalau nilai harus cocok dengan sistem lain (misal kode di spreadsheet).
   */
  value: z.string().optional(),
  /** Conditional visibility sampai level opsi (ARCHITECTURE.md bagian 3.4). */
  conditions: conditionsSchema.optional(),
});
export type FieldOption = z.infer<typeof fieldOptionSchema>;

// ---------------------------------------------------------------------------
// Atribut umum semua field
// ---------------------------------------------------------------------------

const baseFieldShape = {
  id: fieldIdSchema,
  name: fieldNameSchema,
  label: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  helpText: z.string().max(500).optional(),
  conditions: conditionsSchema.optional(),
  /** Metadata bebas untuk UI builder (lebar kolom, ikon, dsb). Tidak dipakai server. */
  meta: z.record(z.string(), z.unknown()).optional(),
};

const requiredFlag = z.boolean().default(false);

// ---------------------------------------------------------------------------
// Schema per field type — atribut validasinya berbeda-beda per tipe
// ---------------------------------------------------------------------------

export const textFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('text'),
  placeholder: z.string().max(255).optional(),
  defaultValue: z.string().optional(),
  validation: z
    .object({
      required: requiredFlag,
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().positive().optional(),
      /** Regex sebagai string, dievaluasi di client maupun server. */
      pattern: z.string().max(500).optional(),
      errorMessage: z.string().max(255).optional(),
    })
    .default({ required: false }),
});

export const textareaFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('textarea'),
  placeholder: z.string().max(255).optional(),
  defaultValue: z.string().optional(),
  rows: z.number().int().min(2).max(30).optional(),
  validation: z
    .object({
      required: requiredFlag,
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().positive().optional(),
      errorMessage: z.string().max(255).optional(),
    })
    .default({ required: false }),
});

export const numberFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('number'),
  placeholder: z.string().max(255).optional(),
  defaultValue: z.number().optional(),
  validation: z
    .object({
      required: requiredFlag,
      min: z.number().optional(),
      max: z.number().optional(),
      integerOnly: z.boolean().default(false),
      errorMessage: z.string().max(255).optional(),
    })
    .default({ required: false, integerOnly: false }),
});

export const emailFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('email'),
  placeholder: z.string().max(255).optional(),
  defaultValue: z.string().optional(),
  validation: z
    .object({
      required: requiredFlag,
      maxLength: z.number().int().positive().optional(),
      errorMessage: z.string().max(255).optional(),
    })
    .default({ required: false }),
});

export const phoneFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('phone'),
  placeholder: z.string().max(255).optional(),
  defaultValue: z.string().optional(),
  validation: z
    .object({
      required: requiredFlag,
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().positive().optional(),
      pattern: z.string().max(500).optional(),
      errorMessage: z.string().max(255).optional(),
    })
    .default({ required: false }),
});

export const dateFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('date'),
  defaultValue: z.string().optional(),
  validation: z
    .object({
      required: requiredFlag,
      /** Format ISO `YYYY-MM-DD`. */
      minDate: z.string().optional(),
      maxDate: z.string().optional(),
      errorMessage: z.string().max(255).optional(),
    })
    .default({ required: false }),
});

export const datetimeFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('datetime'),
  defaultValue: z.string().optional(),
  validation: z
    .object({
      required: requiredFlag,
      /** Format ISO 8601 lengkap. */
      minDate: z.string().optional(),
      maxDate: z.string().optional(),
      errorMessage: z.string().max(255).optional(),
    })
    .default({ required: false }),
});

export const selectFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('select'),
  placeholder: z.string().max(255).optional(),
  /** Id opsi yang dipilih secara default. */
  defaultValue: z.string().optional(),
  options: z.array(fieldOptionSchema).min(1, 'Field select harus punya minimal satu opsi'),
  validation: z
    .object({ required: requiredFlag, errorMessage: z.string().max(255).optional() })
    .default({ required: false }),
});

export const multiselectFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('multiselect'),
  defaultValue: z.array(z.string()).optional(),
  options: z.array(fieldOptionSchema).min(1, 'Field multiselect harus punya minimal satu opsi'),
  validation: z
    .object({
      required: requiredFlag,
      minSelected: z.number().int().nonnegative().optional(),
      maxSelected: z.number().int().positive().optional(),
      errorMessage: z.string().max(255).optional(),
    })
    .default({ required: false }),
});

export const radioFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('radio'),
  defaultValue: z.string().optional(),
  options: z.array(fieldOptionSchema).min(1, 'Field radio harus punya minimal satu opsi'),
  validation: z
    .object({ required: requiredFlag, errorMessage: z.string().max(255).optional() })
    .default({ required: false }),
});

export const checkboxFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('checkbox'),
  defaultValue: z.boolean().optional(),
  validation: z
    .object({
      /** `required: true` berarti kotak ini wajib dicentang. */
      required: requiredFlag,
      errorMessage: z.string().max(255).optional(),
    })
    .default({ required: false }),
});

export const fileUploadFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('file_upload'),
  validation: z
    .object({
      required: requiredFlag,
      maxFileSizeBytes: z.number().int().positive().optional(),
      allowedMimeTypes: z.array(z.string().min(1)).optional(),
      maxFiles: z.number().int().positive().default(1),
      errorMessage: z.string().max(255).optional(),
    })
    .default({ required: false, maxFiles: 1 }),
});

export const sectionHeadingFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('section_heading'),
  /** Tingkat judul untuk semantik HTML di renderer. */
  level: z.union([z.literal(2), z.literal(3)]).default(2),
});

export const formFieldSchema = z.discriminatedUnion('type', [
  textFieldSchema,
  textareaFieldSchema,
  numberFieldSchema,
  emailFieldSchema,
  phoneFieldSchema,
  dateFieldSchema,
  datetimeFieldSchema,
  selectFieldSchema,
  multiselectFieldSchema,
  radioFieldSchema,
  checkboxFieldSchema,
  fileUploadFieldSchema,
  sectionHeadingFieldSchema,
]);
export type FormField = z.infer<typeof formFieldSchema>;

/** Field yang punya daftar opsi — dipersempit dari union di atas. */
export type OptionFormField = Extract<FormField, { options: FieldOption[] }>;

export function hasOptions(field: FormField): field is OptionFormField {
  return 'options' in field && Array.isArray(field.options);
}

/** Field yang menghasilkan jawaban (semua kecuali section_heading). */
export type InputFormField = Exclude<FormField, { type: 'section_heading' }>;

export function isInputFormField(field: FormField): field is InputFormField {
  return field.type !== 'section_heading';
}

// ---------------------------------------------------------------------------
// Pengaturan & schema form
// ---------------------------------------------------------------------------

export const formSettingsSchema = z.object({
  submitButtonLabel: z.string().min(1).max(60).default('Kirim'),
  successMessage: z
    .string()
    .min(1)
    .max(1000)
    .default('Terima kasih, jawaban kamu sudah tersimpan.'),
  /** Kalau diisi, pengisi form diarahkan ke URL ini setelah submit berhasil. */
  redirectUrl: z.url().optional(),
  /** Batas submit per IP per jam untuk endpoint publik. */
  rateLimitPerHour: z.number().int().positive().max(10_000).default(60),
  requireCaptcha: z.boolean().default(false),
  /** Tampilkan indikator progres kalau form panjang. */
  showProgressBar: z.boolean().default(false),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

/**
 * Whitelist domain yang boleh meng-embed form **tidak** disimpan di sini, melainkan
 * di kolom `forms.allowed_domains` — supaya bisa diubah lewat endpoint embed-settings
 * tanpa membuat revisi schema, dan supaya cek CORS tidak perlu memuat schema.
 */
export const formSchemaSchema = z.object({
  version: z.literal(FORM_SCHEMA_VERSION),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  /** Urutan array = urutan tampil di form. */
  fields: z.array(formFieldSchema).default([]),
  // prefault (bukan default): `{}` diproses dulu lewat schema-nya supaya default
  // tiap field settings ikut terisi. `.default()` di Zod 4 melewati parsing.
  settings: formSettingsSchema.prefault({}),
});
export type FormSchema = z.infer<typeof formSchemaSchema>;

export const formStatusSchema = z.enum(['draft', 'published', 'archived']);
export type FormStatus = z.infer<typeof formStatusSchema>;

/**
 * Bentuk form yang dikirim ke form renderer (embed).
 * Hanya berisi yang perlu ditampilkan ke pengisi — tidak ada info internal
 * seperti email tujuan notifikasi atau nama sheet target.
 */
export const publicFormSchema = z.object({
  formKey: z.string().min(1),
  formVersionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  schema: formSchemaSchema,
});
export type PublicForm = z.infer<typeof publicFormSchema>;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Schema form kosong, dipakai saat membuat form baru. */
export function createEmptyFormSchema(title: string, description?: string): FormSchema {
  return formSchemaSchema.parse({
    version: FORM_SCHEMA_VERSION,
    title,
    ...(description ? { description } : {}),
    fields: [],
    settings: {},
  });
}

/** Membuat field baru lengkap dengan default sesuai tipenya. */
export function createField(input: unknown): FormField {
  return formFieldSchema.parse(input);
}

export function getInputFields(schema: FormSchema): InputFormField[] {
  return schema.fields.filter(isInputFormField);
}

export function findField(schema: FormSchema, fieldId: string): FormField | undefined {
  return schema.fields.find((field) => field.id === fieldId);
}

/** Nilai yang disimpan untuk sebuah opsi — `value` kalau ada, kalau tidak `id`. */
export function optionValue(option: FieldOption): string {
  return option.value ?? option.id;
}
