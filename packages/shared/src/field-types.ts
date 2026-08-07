import { z } from 'zod';

/**
 * Daftar field type yang didukung form builder.
 * Sengaja disimpan sebagai const tuple supaya bisa dipakai sebagai sumber tunggal
 * baik untuk validasi runtime (Zod) maupun tipe TypeScript.
 */
export const FIELD_TYPES = [
  // input teks
  'short_text',
  'long_text',
  'email',
  'phone',
  'url',
  'number',
  // tanggal & waktu
  'date',
  'time',
  'datetime',
  // pilihan
  'select',
  'multi_select',
  'radio',
  'checkbox',
  'yes_no',
  'rating',
  // lain-lain
  'file',
  'signature',
  'hidden',
  // elemen tampilan (tidak menghasilkan jawaban)
  'heading',
  'paragraph',
  'divider',
  'page_break',
] as const;

export const fieldTypeSchema = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof fieldTypeSchema>;

/** Field type yang butuh daftar opsi (option-based). */
export const OPTION_FIELD_TYPES = [
  'select',
  'multi_select',
  'radio',
  'checkbox',
] as const satisfies readonly FieldType[];

/** Field type yang murni tampilan — tidak menyimpan jawaban submission. */
export const DISPLAY_FIELD_TYPES = [
  'heading',
  'paragraph',
  'divider',
  'page_break',
] as const satisfies readonly FieldType[];

export function isOptionField(type: FieldType): boolean {
  return (OPTION_FIELD_TYPES as readonly FieldType[]).includes(type);
}

export function isDisplayField(type: FieldType): boolean {
  return (DISPLAY_FIELD_TYPES as readonly FieldType[]).includes(type);
}
