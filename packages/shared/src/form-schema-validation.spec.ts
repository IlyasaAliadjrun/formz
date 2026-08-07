import { formSchemaSchema } from './form-schema';
import {
  validateForPublish,
  validateFormSchema,
  validateParsedFormSchema,
} from './form-schema-validation';

function schemaWith(fields: unknown[]) {
  return { version: 1, title: 'Form Uji', fields, settings: {} };
}

function codesOf(issues: Array<{ code: string }>): string[] {
  return issues.map((issue) => issue.code);
}

describe('validateFormSchema', () => {
  it('menerima schema yang benar', () => {
    const result = validateFormSchema(
      schemaWith([
        { id: 'nama', name: 'nama', type: 'text', label: 'Nama' },
        { id: 'email', name: 'email', type: 'email', label: 'Email' },
      ]),
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('menolak bentuk data yang salah tanpa lanjut ke cek konsistensi', () => {
    const result = validateFormSchema({ version: 1, title: '', fields: 'bukan-array' });

    expect(result.valid).toBe(false);
    expect(codesOf(result.errors)).toContain('invalid_shape');
  });

  it('menolak id field yang dobel', () => {
    const result = validateFormSchema(
      schemaWith([
        { id: 'sama', name: 'satu', type: 'text', label: 'Satu' },
        { id: 'sama', name: 'dua', type: 'text', label: 'Dua' },
      ]),
    );

    expect(result.valid).toBe(false);
    expect(codesOf(result.errors)).toContain('duplicate_field_id');
  });

  it('menolak nama field yang dobel karena dipakai sebagai kolom ekspor', () => {
    const result = validateFormSchema(
      schemaWith([
        { id: 'a', name: 'nama', type: 'text', label: 'Satu' },
        { id: 'b', name: 'NAMA', type: 'text', label: 'Dua' },
      ]),
    );

    expect(codesOf(result.errors)).toContain('duplicate_field_name');
  });

  it('menolak id opsi yang dobel di dalam satu field', () => {
    const result = validateFormSchema(
      schemaWith([
        {
          id: 'pilih',
          name: 'pilih',
          type: 'select',
          label: 'Pilih',
          options: [
            { id: 'x', label: 'X' },
            { id: 'x', label: 'X lagi' },
          ],
        },
      ]),
    );

    expect(codesOf(result.errors)).toContain('duplicate_option_id');
  });

  it('menolak kondisi yang menunjuk field tidak dikenal', () => {
    const result = validateFormSchema(
      schemaWith([
        {
          id: 'b',
          name: 'b',
          type: 'text',
          label: 'B',
          conditions: {
            visibility: {
              action: 'show',
              logic: 'AND',
              rules: [{ fieldId: 'tidak_ada', operator: 'equals', value: 'x' }],
            },
          },
        },
      ]),
    );

    expect(result.valid).toBe(false);
    expect(codesOf(result.errors)).toContain('unknown_condition_field');
  });

  it('menolak kondisi yang menunjuk opsi tidak dikenal', () => {
    const result = validateFormSchema(
      schemaWith([
        {
          id: 'a',
          name: 'a',
          type: 'select',
          label: 'A',
          options: [{ id: 'opt_1', label: 'Satu' }],
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
              rules: [{ fieldId: 'a', operator: 'equals', value: 'opt_9' }],
            },
          },
        },
      ]),
    );

    expect(codesOf(result.errors)).toContain('unknown_condition_option');
  });

  it('menolak kondisi yang menunjuk dirinya sendiri', () => {
    const result = validateFormSchema(
      schemaWith([
        {
          id: 'a',
          name: 'a',
          type: 'text',
          label: 'A',
          conditions: {
            visibility: {
              action: 'show',
              logic: 'AND',
              rules: [{ fieldId: 'a', operator: 'is_not_empty' }],
            },
          },
        },
      ]),
    );

    expect(codesOf(result.errors)).toContain('self_referencing_condition');
  });

  it('menolak kondisi yang menunjuk section_heading', () => {
    const result = validateFormSchema(
      schemaWith([
        { id: 'judul', name: 'judul', type: 'section_heading', label: 'Bagian 1' },
        {
          id: 'b',
          name: 'b',
          type: 'text',
          label: 'B',
          conditions: {
            visibility: {
              action: 'show',
              logic: 'AND',
              rules: [{ fieldId: 'judul', operator: 'is_not_empty' }],
            },
          },
        },
      ]),
    );

    expect(codesOf(result.errors)).toContain('condition_on_non_input_field');
  });

  it('mendeteksi kondisi yang saling melingkar', () => {
    const result = validateFormSchema(
      schemaWith([
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
      ]),
    );

    expect(result.valid).toBe(false);
    expect(codesOf(result.errors)).toContain('cyclic_condition');
  });

  it('menolak operator yang butuh nilai tapi nilainya kosong', () => {
    const result = validateFormSchema(
      schemaWith([
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
              rules: [{ fieldId: 'a', operator: 'equals' }],
            },
          },
        },
      ]),
    );

    expect(codesOf(result.errors)).toContain('missing_condition_value');
  });

  it('menolak operator in yang nilainya bukan array', () => {
    const result = validateFormSchema(
      schemaWith([
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
              rules: [{ fieldId: 'a', operator: 'in', value: 'bukan-array' }],
            },
          },
        },
      ]),
    );

    expect(codesOf(result.errors)).toContain('condition_value_not_array');
  });

  it('menolak rentang validasi yang terbalik', () => {
    const result = validateFormSchema(
      schemaWith([
        {
          id: 'a',
          name: 'a',
          type: 'text',
          label: 'A',
          validation: { minLength: 10, maxLength: 5 },
        },
      ]),
    );

    expect(codesOf(result.errors)).toContain('invalid_range');
  });

  it('menolak pola regex yang tidak bisa dikompilasi', () => {
    const result = validateFormSchema(
      schemaWith([
        { id: 'a', name: 'a', type: 'text', label: 'A', validation: { pattern: '([a-z' } },
      ]),
    );

    expect(codesOf(result.errors)).toContain('invalid_pattern');
  });

  it('memperingatkan (bukan menolak) kondisi yang menunjuk field di bawahnya', () => {
    const result = validateFormSchema(
      schemaWith([
        {
          id: 'atas',
          name: 'atas',
          type: 'text',
          label: 'Atas',
          conditions: {
            visibility: {
              action: 'show',
              logic: 'AND',
              rules: [{ fieldId: 'bawah', operator: 'is_not_empty' }],
            },
          },
        },
        { id: 'bawah', name: 'bawah', type: 'text', label: 'Bawah' },
      ]),
    );

    expect(result.valid).toBe(true);
    expect(codesOf(result.warnings)).toContain('forward_reference');
  });

  it('menolak field select tanpa opsi lewat pemeriksaan bentuk', () => {
    const result = validateFormSchema(
      schemaWith([{ id: 'a', name: 'a', type: 'select', label: 'A', options: [] }]),
    );

    expect(result.valid).toBe(false);
  });
});

describe('validateForPublish', () => {
  it('menolak form yang belum punya field isian', () => {
    const schema = formSchemaSchema.parse(
      schemaWith([{ id: 'judul', name: 'judul', type: 'section_heading', label: 'Bagian 1' }]),
    );

    const result = validateForPublish(schema);

    expect(result.valid).toBe(false);
    expect(codesOf(result.errors)).toContain('no_input_fields');
  });

  it('mengizinkan form yang punya minimal satu field isian', () => {
    const schema = formSchemaSchema.parse(
      schemaWith([
        { id: 'judul', name: 'judul', type: 'section_heading', label: 'Bagian 1' },
        { id: 'nama', name: 'nama', type: 'text', label: 'Nama' },
      ]),
    );

    expect(validateForPublish(schema).valid).toBe(true);
  });

  it('validateParsedFormSchema hanya memberi peringatan untuk form kosong', () => {
    const schema = formSchemaSchema.parse(schemaWith([]));
    const result = validateParsedFormSchema(schema);

    expect(result.valid).toBe(true);
    expect(codesOf(result.warnings)).toContain('no_input_fields');
  });
});
