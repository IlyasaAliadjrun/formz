import {
  FIELD_TYPE_DEFINITIONS,
  formFieldSchema,
  type FieldType,
  type FormField,
  type FormSchema,
} from '@formz/shared';

/** Id pendek yang cukup acak untuk tidak bentrok di dalam satu form. */
function shortId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export function createOptionId(): string {
  return shortId('opt');
}

/**
 * Nama field dipakai sebagai header kolom saat ekspor & sync spreadsheet, jadi
 * harus unik dan hanya berisi huruf/angka/garis bawah.
 */
function buildUniqueName(base: string, taken: ReadonlySet<string>): string {
  const normalized =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^([0-9])/, 'f_$1') || 'field';

  if (!taken.has(normalized)) return normalized;

  let counter = 2;
  while (taken.has(`${normalized}_${counter}`)) counter += 1;

  return `${normalized}_${counter}`;
}

const DEFAULT_LABELS: Record<FieldType, string> = {
  text: 'Pertanyaan teks singkat',
  textarea: 'Pertanyaan teks panjang',
  number: 'Pertanyaan angka',
  email: 'Alamat email',
  phone: 'Nomor telepon',
  date: 'Tanggal',
  datetime: 'Tanggal & waktu',
  select: 'Pilih satu (dropdown)',
  multiselect: 'Pilih beberapa',
  radio: 'Pilih satu',
  checkbox: 'Saya menyetujui',
  file_upload: 'Unggah berkas',
  section_heading: 'Judul bagian',
};

/** Membuat field baru dengan default yang sudah lolos validasi schema. */
export function createDefaultField(type: FieldType, existingSchema: FormSchema): FormField {
  const takenNames = new Set(existingSchema.fields.map((field) => field.name.toLowerCase()));
  const label = DEFAULT_LABELS[type];

  const base = {
    id: shortId('field'),
    name: buildUniqueName(label, takenNames),
    label,
  };

  const definition = FIELD_TYPE_DEFINITIONS[type];

  const draft: Record<string, unknown> = { ...base, type };

  if (definition.requiresOptions) {
    draft.options = [
      { id: createOptionId(), label: 'Opsi 1' },
      { id: createOptionId(), label: 'Opsi 2' },
    ];
  }

  if (type === 'section_heading') {
    draft.level = 2;
  }

  // parse() mengisi seluruh nilai default (validation, dst) sesuai tipenya.
  return formFieldSchema.parse(draft);
}

/** Menyalin field beserta seluruh propertinya dengan id & nama baru. */
export function duplicateField(field: FormField, existingSchema: FormSchema): FormField {
  const takenNames = new Set(existingSchema.fields.map((item) => item.name.toLowerCase()));

  const copy: Record<string, unknown> = {
    ...field,
    id: shortId('field'),
    name: buildUniqueName(`${field.name}_salinan`, takenNames),
    label: `${field.label} (salinan)`,
    // Kondisi tidak ikut disalin: menyalin rule yang menunjuk field lain hampir
    // selalu bukan yang dimaksud, dan lebih aman dimulai tanpa kondisi.
    conditions: undefined,
  };

  if ('options' in field && Array.isArray(field.options)) {
    copy.options = field.options.map((option) => ({
      ...option,
      id: createOptionId(),
      conditions: undefined,
    }));
  }

  return formFieldSchema.parse(copy);
}

export { shortId };
