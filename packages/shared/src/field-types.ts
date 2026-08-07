import { z } from 'zod';

/**
 * Katalog field type yang didukung form builder.
 *
 * Ini sumber tunggal untuk tiga hal sekaligus: tipe TypeScript, validasi runtime
 * (Zod), dan metadata yang dipakai UI builder untuk tahu atribut apa saja yang
 * relevan per tipe. Menambah field type baru cukup di file ini + schema-nya di
 * form-schema.ts, tidak perlu menyentuh database (schema form disimpan JSONB).
 */
export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'email',
  'phone',
  'date',
  'datetime',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'file_upload',
  'section_heading',
] as const;

export const fieldTypeSchema = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof fieldTypeSchema>;

/** Bentuk jawaban yang dihasilkan sebuah field type. */
export const ANSWER_KINDS = ['string', 'number', 'boolean', 'string[]', 'file[]', 'none'] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** Atribut validasi yang boleh dipasang pada sebuah field type. */
export const VALIDATION_ATTRIBUTES = [
  'required',
  'minLength',
  'maxLength',
  'pattern',
  'min',
  'max',
  'integerOnly',
  'minDate',
  'maxDate',
  'minSelected',
  'maxSelected',
  'maxFileSizeBytes',
  'allowedMimeTypes',
  'maxFiles',
] as const;
export type ValidationAttribute = (typeof VALIDATION_ATTRIBUTES)[number];

export interface FieldTypeDefinition {
  type: FieldType;
  /** Label yang tampil di panel field UI builder. */
  label: string;
  /** Penjelasan singkat untuk UI builder. */
  description: string;
  /** Apakah field ini menghasilkan jawaban yang disimpan di submission. */
  producesAnswer: boolean;
  /** Apakah field ini wajib punya daftar opsi ber-id. */
  requiresOptions: boolean;
  /** Apakah jawabannya boleh lebih dari satu nilai. */
  multiValue: boolean;
  answerKind: AnswerKind;
  /** Atribut validasi yang berlaku untuk tipe ini. */
  validationAttributes: readonly ValidationAttribute[];
}

export const FIELD_TYPE_DEFINITIONS = {
  text: {
    type: 'text',
    label: 'Teks Singkat',
    description: 'Input satu baris untuk jawaban pendek',
    producesAnswer: true,
    requiresOptions: false,
    multiValue: false,
    answerKind: 'string',
    validationAttributes: ['required', 'minLength', 'maxLength', 'pattern'],
  },
  textarea: {
    type: 'textarea',
    label: 'Teks Panjang',
    description: 'Input beberapa baris untuk jawaban panjang',
    producesAnswer: true,
    requiresOptions: false,
    multiValue: false,
    answerKind: 'string',
    validationAttributes: ['required', 'minLength', 'maxLength'],
  },
  number: {
    type: 'number',
    label: 'Angka',
    description: 'Input numerik dengan batas minimum/maksimum',
    producesAnswer: true,
    requiresOptions: false,
    multiValue: false,
    answerKind: 'number',
    validationAttributes: ['required', 'min', 'max', 'integerOnly'],
  },
  email: {
    type: 'email',
    label: 'Email',
    description: 'Input email dengan validasi format',
    producesAnswer: true,
    requiresOptions: false,
    multiValue: false,
    answerKind: 'string',
    validationAttributes: ['required', 'maxLength'],
  },
  phone: {
    type: 'phone',
    label: 'Nomor Telepon',
    description: 'Input nomor telepon, format bisa dibatasi pola',
    producesAnswer: true,
    requiresOptions: false,
    multiValue: false,
    answerKind: 'string',
    validationAttributes: ['required', 'minLength', 'maxLength', 'pattern'],
  },
  date: {
    type: 'date',
    label: 'Tanggal',
    description: 'Pemilih tanggal (tanpa jam)',
    producesAnswer: true,
    requiresOptions: false,
    multiValue: false,
    answerKind: 'string',
    validationAttributes: ['required', 'minDate', 'maxDate'],
  },
  datetime: {
    type: 'datetime',
    label: 'Tanggal & Waktu',
    description: 'Pemilih tanggal beserta jam',
    producesAnswer: true,
    requiresOptions: false,
    multiValue: false,
    answerKind: 'string',
    validationAttributes: ['required', 'minDate', 'maxDate'],
  },
  select: {
    type: 'select',
    label: 'Dropdown',
    description: 'Pilih satu dari daftar opsi',
    producesAnswer: true,
    requiresOptions: true,
    multiValue: false,
    answerKind: 'string',
    validationAttributes: ['required'],
  },
  multiselect: {
    type: 'multiselect',
    label: 'Pilihan Ganda',
    description: 'Pilih beberapa dari daftar opsi',
    producesAnswer: true,
    requiresOptions: true,
    multiValue: true,
    answerKind: 'string[]',
    validationAttributes: ['required', 'minSelected', 'maxSelected'],
  },
  radio: {
    type: 'radio',
    label: 'Radio Button',
    description: 'Pilih satu dari daftar opsi, semua opsi tampil sekaligus',
    producesAnswer: true,
    requiresOptions: true,
    multiValue: false,
    answerKind: 'string',
    validationAttributes: ['required'],
  },
  checkbox: {
    type: 'checkbox',
    label: 'Checkbox',
    description: 'Satu kotak centang ya/tidak, misal persetujuan syarat & ketentuan',
    producesAnswer: true,
    requiresOptions: false,
    multiValue: false,
    answerKind: 'boolean',
    validationAttributes: ['required'],
  },
  file_upload: {
    type: 'file_upload',
    label: 'Unggah Berkas',
    description: 'Unggah satu atau beberapa berkas lewat presigned URL',
    producesAnswer: true,
    requiresOptions: false,
    multiValue: true,
    answerKind: 'file[]',
    validationAttributes: ['required', 'maxFileSizeBytes', 'allowedMimeTypes', 'maxFiles'],
  },
  section_heading: {
    type: 'section_heading',
    label: 'Judul Bagian',
    description: 'Elemen non-input untuk membagi form menjadi beberapa bagian',
    producesAnswer: false,
    requiresOptions: false,
    multiValue: false,
    answerKind: 'none',
    validationAttributes: [],
  },
} as const satisfies Record<FieldType, FieldTypeDefinition>;

export function getFieldTypeDefinition(type: FieldType): FieldTypeDefinition {
  return FIELD_TYPE_DEFINITIONS[type];
}

/** Field type yang wajib punya daftar opsi ber-id unik. */
export const OPTION_FIELD_TYPES = ['select', 'multiselect', 'radio'] as const;
export type OptionFieldType = (typeof OPTION_FIELD_TYPES)[number];

/** Field type yang tidak menghasilkan jawaban di submission. */
export const DISPLAY_FIELD_TYPES = ['section_heading'] as const;
export type DisplayFieldType = (typeof DISPLAY_FIELD_TYPES)[number];

export function isOptionField(type: FieldType): type is OptionFieldType {
  return FIELD_TYPE_DEFINITIONS[type].requiresOptions;
}

export function isDisplayField(type: FieldType): type is DisplayFieldType {
  return !FIELD_TYPE_DEFINITIONS[type].producesAnswer;
}

export function isInputField(type: FieldType): boolean {
  return FIELD_TYPE_DEFINITIONS[type].producesAnswer;
}

export function supportsValidationAttribute(
  type: FieldType,
  attribute: ValidationAttribute,
): boolean {
  return (
    FIELD_TYPE_DEFINITIONS[type].validationAttributes as readonly ValidationAttribute[]
  ).includes(attribute);
}
