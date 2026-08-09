import { validateAnswer, validateAnswers } from './answer-validation';
import { formFieldSchema, formSchemaSchema, type FormField, type FormSchema } from './form-schema';

function buildSchema(fields: unknown[]): FormSchema {
  return formSchemaSchema.parse({ version: 1, title: 'Form Uji', fields, settings: {} });
}

function buildField(input: unknown): FormField {
  return formFieldSchema.parse(input);
}

const jenisLayanan = {
  id: 'field_001',
  name: 'jenis_layanan',
  type: 'select',
  label: 'Jenis Layanan',
  options: [
    { id: 'opt_1', label: 'Konsultasi' },
    { id: 'opt_2', label: 'Implementasi' },
  ],
  validation: { required: true },
};

/** Field yang hanya muncul kalau "Implementasi" dipilih, dan wajib diisi. */
const durasi = {
  id: 'field_002',
  name: 'durasi',
  type: 'number',
  label: 'Durasi',
  validation: { required: true, min: 1, max: 12, integerOnly: true },
  conditions: {
    visibility: {
      action: 'show',
      logic: 'AND',
      rules: [{ fieldId: 'field_001', operator: 'equals', value: 'opt_2' }],
    },
  },
};

describe('validateAnswers', () => {
  it('menolak field wajib yang kosong', () => {
    const schema = buildSchema([jenisLayanan]);

    const result = validateAnswers(schema, {});

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ fieldId: 'field_001', code: 'required' });
  });

  it('tidak menuntut field wajib yang sedang tersembunyi', () => {
    const schema = buildSchema([jenisLayanan, durasi]);

    // "Konsultasi" membuat field durasi tersembunyi, jadi required-nya tidak berlaku.
    const result = validateAnswers(schema, { field_001: 'opt_1' });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('membuang jawaban untuk field yang seharusnya tersembunyi', () => {
    const schema = buildSchema([jenisLayanan, durasi]);

    // Inilah manipulasi request yang disebut ARCHITECTURE.md bagian 6 poin 2:
    // durasi dikirim padahal kondisinya tidak terpenuhi.
    const result = validateAnswers(schema, { field_001: 'opt_1', field_002: 9 });

    expect(result.valid).toBe(true);
    expect(result.answers).toEqual({ field_001: 'opt_1' });
    expect(result.answers.field_002).toBeUndefined();
  });

  it('menuntut field yang kondisinya terpenuhi', () => {
    const schema = buildSchema([jenisLayanan, durasi]);

    const result = validateAnswers(schema, { field_001: 'opt_2' });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ fieldId: 'field_002', code: 'required' });
  });

  it('menolak opsi yang tidak ada di daftar', () => {
    const schema = buildSchema([jenisLayanan]);

    const result = validateAnswers(schema, { field_001: 'opt_palsu' });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('unknown_option');
  });

  it('membuang opsi tersembunyi pada multiselect', () => {
    const schema = buildSchema([
      jenisLayanan,
      {
        id: 'field_003',
        name: 'tambahan',
        type: 'multiselect',
        label: 'Layanan tambahan',
        options: [
          { id: 'opt_a', label: 'Pelatihan' },
          {
            id: 'opt_b',
            label: 'Migrasi data',
            conditions: {
              visibility: {
                action: 'show',
                logic: 'AND',
                rules: [{ fieldId: 'field_001', operator: 'equals', value: 'opt_2' }],
              },
            },
          },
        ],
      },
    ]);

    const result = validateAnswers(schema, {
      field_001: 'opt_1',
      field_003: ['opt_a', 'opt_b'],
    });

    expect(result.valid).toBe(true);
    expect(result.answers.field_003).toEqual(['opt_a']);
  });
});

describe('validateAnswer', () => {
  it('memeriksa format email', () => {
    const field = buildField({
      id: 'f',
      name: 'email',
      type: 'email',
      label: 'Email',
      validation: { required: true },
    });

    expect(validateAnswer(field, 'bukan-email')).toHaveLength(1);
    expect(validateAnswer(field, 'bukan-email')[0]?.code).toBe('invalid_email');
    expect(validateAnswer(field, 'orang@contoh.com')).toEqual([]);
  });

  it('memeriksa rentang dan bilangan bulat pada number', () => {
    const field = buildField(durasi);

    expect(validateAnswer(field, 0)[0]?.code).toBe('too_small');
    expect(validateAnswer(field, 99)[0]?.code).toBe('too_large');
    expect(validateAnswer(field, 3.5)[0]?.code).toBe('not_integer');
    expect(validateAnswer(field, 6)).toEqual([]);
  });

  it('memeriksa pola regex dan panjang teks', () => {
    const field = buildField({
      id: 'f',
      name: 'hp',
      type: 'phone',
      label: 'Nomor HP',
      validation: { required: false, minLength: 10, pattern: '^08[0-9]+$' },
    });

    expect(validateAnswer(field, '0812')[0]?.code).toBe('too_short');
    expect(validateAnswer(field, '62812345678')[0]?.code).toBe('invalid_pattern');
    expect(validateAnswer(field, '081234567890')).toEqual([]);
  });

  it('memakai pesan error kustom kalau disetel', () => {
    const field = buildField({
      id: 'f',
      name: 'nama',
      type: 'text',
      label: 'Nama',
      validation: { required: true, errorMessage: 'Nama lengkap harus diisi ya' },
    });

    expect(validateAnswer(field, undefined)[0]?.message).toBe('Nama lengkap harus diisi ya');
  });

  it('menganggap checkbox yang tidak dicentang sebagai belum diisi', () => {
    const field = buildField({
      id: 'f',
      name: 'setuju',
      type: 'checkbox',
      label: 'Saya setuju',
      validation: { required: true },
    });

    expect(validateAnswer(field, false)[0]?.code).toBe('required');
    expect(validateAnswer(field, true)).toEqual([]);
  });

  it('belum menegakkan aturan file_upload karena unggahnya belum aktif', () => {
    const field = buildField({
      id: 'f',
      name: 'lampiran',
      type: 'file_upload',
      label: 'Lampiran',
      validation: { required: true },
    });

    expect(validateAnswer(field, undefined)).toEqual([]);
  });
});
