import {
  evaluateConditions,
  getEffectiveAnswers,
  isOptionVisible,
  type AnswerMap,
} from './condition-evaluator';
import { formSchemaSchema, type FormSchema } from './form-schema';

/**
 * Schema uji mengikuti contoh di ARCHITECTURE.md bagian 3.4:
 * "Jenis Layanan" (select) menentukan tampil-tidaknya field di bawahnya.
 */
function buildSchema(fields: unknown[]): FormSchema {
  return formSchemaSchema.parse({
    version: 1,
    title: 'Form Uji',
    fields,
    settings: {},
  });
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
};

describe('evaluateConditions', () => {
  it('menampilkan semua field kalau tidak ada kondisi', () => {
    const schema = buildSchema([
      jenisLayanan,
      { id: 'field_002', name: 'catatan', type: 'textarea', label: 'Catatan' },
    ]);

    const result = evaluateConditions(schema, {});

    expect(result.visibleFieldIds).toEqual(['field_001', 'field_002']);
    expect(result.hiddenFieldIds).toEqual([]);
  });

  it('menyembunyikan field sampai rule show-nya terpenuhi', () => {
    const schema = buildSchema([
      jenisLayanan,
      {
        id: 'field_003',
        name: 'durasi_implementasi',
        type: 'number',
        label: 'Durasi Implementasi',
        conditions: {
          visibility: {
            action: 'show',
            logic: 'AND',
            rules: [{ fieldId: 'field_001', operator: 'equals', value: 'opt_2' }],
          },
        },
      },
    ]);

    expect(evaluateConditions(schema, {}).hiddenFieldIds).toContain('field_003');
    expect(evaluateConditions(schema, { field_001: 'opt_1' }).hiddenFieldIds).toContain(
      'field_003',
    );
    expect(evaluateConditions(schema, { field_001: 'opt_2' }).visibleFieldIds).toContain(
      'field_003',
    );
  });

  it('membalik hasil untuk action hide', () => {
    const schema = buildSchema([
      jenisLayanan,
      {
        id: 'field_004',
        name: 'alasan',
        type: 'text',
        label: 'Alasan',
        conditions: {
          visibility: {
            action: 'hide',
            logic: 'AND',
            rules: [{ fieldId: 'field_001', operator: 'equals', value: 'opt_1' }],
          },
        },
      },
    ]);

    expect(evaluateConditions(schema, { field_001: 'opt_1' }).hiddenFieldIds).toContain(
      'field_004',
    );
    expect(evaluateConditions(schema, { field_001: 'opt_2' }).visibleFieldIds).toContain(
      'field_004',
    );
  });

  it('menghormati logic OR dan AND', () => {
    const base = (logic: 'AND' | 'OR') => [
      { id: 'a', name: 'a', type: 'text', label: 'A' },
      { id: 'b', name: 'b', type: 'text', label: 'B' },
      {
        id: 'c',
        name: 'c',
        type: 'text',
        label: 'C',
        conditions: {
          visibility: {
            action: 'show',
            logic,
            rules: [
              { fieldId: 'a', operator: 'equals', value: 'ya' },
              { fieldId: 'b', operator: 'equals', value: 'ya' },
            ],
          },
        },
      },
    ];

    const andSchema = buildSchema(base('AND'));
    const orSchema = buildSchema(base('OR'));

    expect(evaluateConditions(andSchema, { a: 'ya' }).hiddenFieldIds).toContain('c');
    expect(evaluateConditions(andSchema, { a: 'ya', b: 'ya' }).visibleFieldIds).toContain('c');
    expect(evaluateConditions(orSchema, { a: 'ya' }).visibleFieldIds).toContain('c');
  });

  it('meruntuhkan rantai kondisi saat field di atasnya tersembunyi', () => {
    // A → B → C. Kalau A membuat B tersembunyi, jawaban B dianggap kosong
    // sehingga C ikut tersembunyi meskipun jawaban B masih tersimpan.
    const schema = buildSchema([
      { id: 'a', name: 'a', type: 'text', label: 'A' },
      {
        id: 'b',
        name: 'b',
        type: 'text',
        label: 'B',
        conditions: {
          visibility: {
            action: 'show',
            logic: 'AND',
            rules: [{ fieldId: 'a', operator: 'equals', value: 'buka' }],
          },
        },
      },
      {
        id: 'c',
        name: 'c',
        type: 'text',
        label: 'C',
        conditions: {
          visibility: {
            action: 'show',
            logic: 'AND',
            rules: [{ fieldId: 'b', operator: 'is_not_empty' }],
          },
        },
      },
    ]);

    const terbuka = evaluateConditions(schema, { a: 'buka', b: 'terisi' });
    expect(terbuka.visibleFieldIds).toEqual(['a', 'b', 'c']);

    const tertutup = evaluateConditions(schema, { a: 'tutup', b: 'terisi' });
    expect(tertutup.hiddenFieldIds).toContain('b');
    expect(tertutup.hiddenFieldIds).toContain('c');
  });

  it('mengevaluasi visibilitas sampai level opsi', () => {
    const schema = buildSchema([
      {
        id: 'tipe',
        name: 'tipe',
        type: 'radio',
        label: 'Tipe',
        options: [
          { id: 'pro', label: 'Pro' },
          { id: 'basic', label: 'Basic' },
        ],
      },
      {
        id: 'fitur',
        name: 'fitur',
        type: 'multiselect',
        label: 'Fitur',
        options: [
          { id: 'dasar', label: 'Dasar' },
          {
            id: 'lanjutan',
            label: 'Lanjutan',
            conditions: {
              visibility: {
                action: 'show',
                logic: 'AND',
                rules: [{ fieldId: 'tipe', operator: 'equals', value: 'pro' }],
              },
            },
          },
        ],
      },
    ]);

    const basic = evaluateConditions(schema, { tipe: 'basic' });
    expect(isOptionVisible(basic, 'fitur', 'dasar')).toBe(true);
    expect(isOptionVisible(basic, 'fitur', 'lanjutan')).toBe(false);

    const pro = evaluateConditions(schema, { tipe: 'pro' });
    expect(isOptionVisible(pro, 'fitur', 'lanjutan')).toBe(true);
  });

  it('menyembunyikan seluruh opsi saat field induknya tersembunyi', () => {
    const schema = buildSchema([
      { id: 'a', name: 'a', type: 'text', label: 'A' },
      {
        id: 'pilihan',
        name: 'pilihan',
        type: 'select',
        label: 'Pilihan',
        options: [{ id: 'x', label: 'X' }],
        conditions: {
          visibility: {
            action: 'show',
            logic: 'AND',
            rules: [{ fieldId: 'a', operator: 'equals', value: 'ya' }],
          },
        },
      },
    ]);

    const result = evaluateConditions(schema, { a: 'tidak' });
    expect(result.fields.pilihan?.visibleOptionIds).toEqual([]);
    expect(result.fields.pilihan?.hiddenOptionIds).toEqual(['x']);
  });

  describe('operator', () => {
    const withRule = (operator: string, value?: unknown) =>
      buildSchema([
        { id: 'src', name: 'src', type: 'text', label: 'Sumber' },
        {
          id: 'target',
          name: 'target',
          type: 'text',
          label: 'Target',
          conditions: {
            visibility: {
              action: 'show',
              logic: 'AND',
              rules: [{ fieldId: 'src', operator, ...(value === undefined ? {} : { value }) }],
            },
          },
        },
      ]);

    const visible = (schema: FormSchema, answers: AnswerMap) =>
      evaluateConditions(schema, answers).visibleFieldIds.includes('target');

    it('contains & not_contains untuk teks', () => {
      expect(visible(withRule('contains', 'abc'), { src: 'xxabcxx' })).toBe(true);
      expect(visible(withRule('contains', 'abc'), { src: 'xxx' })).toBe(false);
      expect(visible(withRule('not_contains', 'abc'), { src: 'xxx' })).toBe(true);
    });

    it('greater_than membandingkan angka sebagai angka, bukan string', () => {
      // Sebagai string, "9" > "10". Sebagai angka, tidak.
      expect(visible(withRule('greater_than', 10), { src: '9' })).toBe(false);
      expect(visible(withRule('greater_than', 10), { src: '11' })).toBe(true);
    });

    it('greater_than juga bekerja untuk tanggal ISO', () => {
      expect(visible(withRule('greater_than', '2026-01-01'), { src: '2026-06-01' })).toBe(true);
      expect(visible(withRule('greater_than', '2026-01-01'), { src: '2025-06-01' })).toBe(false);
    });

    it('is_empty menghitung string kosong, array kosong, dan checkbox tidak dicentang', () => {
      const schema = withRule('is_empty');
      expect(visible(schema, {})).toBe(true);
      expect(visible(schema, { src: '' })).toBe(true);
      expect(visible(schema, { src: [] })).toBe(true);
      expect(visible(schema, { src: false })).toBe(true);
      expect(visible(schema, { src: 'ada' })).toBe(false);
    });

    it('in & not_in membandingkan terhadap daftar nilai', () => {
      expect(visible(withRule('in', ['a', 'b']), { src: 'b' })).toBe(true);
      expect(visible(withRule('in', ['a', 'b']), { src: 'c' })).toBe(false);
      expect(visible(withRule('not_in', ['a', 'b']), { src: 'c' })).toBe(true);
    });

    it('equals pada field multi-nilai berarti "salah satu jawabannya sama"', () => {
      expect(visible(withRule('equals', 'b'), { src: ['a', 'b'] })).toBe(true);
      expect(visible(withRule('equals', 'c'), { src: ['a', 'b'] })).toBe(false);
    });
  });

  it('tetap menghasilkan jawaban meski ada kondisi melingkar', () => {
    const schema = buildSchema([
      {
        id: 'a',
        name: 'a',
        type: 'text',
        label: 'A',
        conditions: {
          visibility: {
            action: 'show',
            logic: 'AND',
            rules: [{ fieldId: 'b', operator: 'is_not_empty' }],
          },
        },
      },
      {
        id: 'b',
        name: 'b',
        type: 'text',
        label: 'B',
        conditions: {
          visibility: {
            action: 'show',
            logic: 'AND',
            rules: [{ fieldId: 'a', operator: 'is_not_empty' }],
          },
        },
      },
    ]);

    // Yang penting tidak menggantung / melempar error.
    const result = evaluateConditions(schema, { a: 'x', b: 'y' });
    expect(result.fields.a).toBeDefined();
    expect(result.fields.b).toBeDefined();
  });
});

describe('getEffectiveAnswers', () => {
  it('membuang jawaban milik field yang tersembunyi', () => {
    const schema = buildSchema([
      jenisLayanan,
      {
        id: 'field_003',
        name: 'durasi',
        type: 'number',
        label: 'Durasi',
        conditions: {
          visibility: {
            action: 'show',
            logic: 'AND',
            rules: [{ fieldId: 'field_001', operator: 'equals', value: 'opt_2' }],
          },
        },
      },
    ]);

    // Inilah skenario keamanan yang disebut ARCHITECTURE.md bagian 6 poin 2:
    // pengirim memaksa mengisi field yang seharusnya tersembunyi.
    const effective = getEffectiveAnswers(schema, { field_001: 'opt_1', field_003: 99 });

    expect(effective).toEqual({ field_001: 'opt_1' });
    expect(effective.field_003).toBeUndefined();
  });

  it('membuang opsi tersembunyi dari jawaban multiselect', () => {
    const schema = buildSchema([
      {
        id: 'tipe',
        name: 'tipe',
        type: 'radio',
        label: 'Tipe',
        options: [
          { id: 'pro', label: 'Pro' },
          { id: 'basic', label: 'Basic' },
        ],
      },
      {
        id: 'fitur',
        name: 'fitur',
        type: 'multiselect',
        label: 'Fitur',
        options: [
          { id: 'dasar', label: 'Dasar' },
          {
            id: 'lanjutan',
            label: 'Lanjutan',
            conditions: {
              visibility: {
                action: 'show',
                logic: 'AND',
                rules: [{ fieldId: 'tipe', operator: 'equals', value: 'pro' }],
              },
            },
          },
        ],
      },
    ]);

    const effective = getEffectiveAnswers(schema, { tipe: 'basic', fitur: ['dasar', 'lanjutan'] });

    expect(effective.fitur).toEqual(['dasar']);
  });

  it('tidak menyertakan section_heading', () => {
    const schema = buildSchema([
      { id: 'judul', name: 'judul_bagian', type: 'section_heading', label: 'Data Diri' },
      { id: 'nama', name: 'nama', type: 'text', label: 'Nama' },
    ]);

    const effective = getEffectiveAnswers(schema, { judul: 'apa pun', nama: 'Budi' });

    expect(effective).toEqual({ nama: 'Budi' });
  });
});
