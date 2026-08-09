import { CHECKBOX_NO, CHECKBOX_YES, describeAnswers, formatAnswerValue } from './answer-display';
import { formFieldSchema, formSchemaSchema, type FormField, type FormSchema } from './form-schema';

function buildSchema(fields: unknown[]): FormSchema {
  return formSchemaSchema.parse({ version: 1, title: 'Form Uji', fields, settings: {} });
}

function buildField(input: unknown): FormField {
  return formFieldSchema.parse(input);
}

const kelas = {
  id: 'f_kelas',
  name: 'kelas',
  type: 'select',
  label: 'Kelas',
  options: [
    { id: 'opt_dasar', label: 'Kelas Dasar' },
    { id: 'opt_lanjut', label: 'Kelas Lanjutan' },
  ],
};

describe('formatAnswerValue', () => {
  it('menerjemahkan id opsi menjadi label', () => {
    expect(formatAnswerValue(buildField(kelas), 'opt_dasar')).toBe('Kelas Dasar');
  });

  it('menerima nilai tersimpan kustom, bukan hanya id opsi', () => {
    const field = buildField({
      ...kelas,
      options: [{ id: 'opt_dasar', label: 'Kelas Dasar', value: 'DSR' }],
    });

    expect(formatAnswerValue(field, 'DSR')).toBe('Kelas Dasar');
  });

  it('menampilkan opsi yang sudah dihapus apa adanya, bukan sel kosong', () => {
    // Lebih berguna melihat `opt_hilang` daripada tidak melihat apa-apa saat
    // menelusuri kenapa sebuah jawaban lama terlihat aneh.
    expect(formatAnswerValue(buildField(kelas), 'opt_hilang')).toBe('opt_hilang');
  });

  it('menggabungkan label untuk multiselect', () => {
    const field = buildField({
      id: 'f_topik',
      name: 'topik',
      type: 'multiselect',
      label: 'Topik',
      options: [
        { id: 'opt_ml', label: 'Machine Learning' },
        { id: 'opt_web', label: 'Web Development' },
      ],
    });

    expect(formatAnswerValue(field, ['opt_ml', 'opt_web'])).toBe(
      'Machine Learning, Web Development',
    );
  });

  it('membedakan checkbox tercentang dan tidak', () => {
    const field = buildField({ id: 'f_ok', name: 'ok', type: 'checkbox', label: 'Setuju' });

    expect(formatAnswerValue(field, true)).toBe(CHECKBOX_YES);
    // `false` adalah jawaban, bukan kekosongan — tidak boleh jadi string kosong.
    expect(formatAnswerValue(field, false)).toBe(CHECKBOX_NO);
    expect(formatAnswerValue(field, undefined)).toBe(CHECKBOX_NO);
  });

  it('merapikan datetime tanpa menggeser jamnya', () => {
    const field = buildField({ id: 'f_t', name: 'waktu', type: 'datetime', label: 'Waktu' });

    // Nilai dari input datetime-local adalah waktu lokal pengisi tanpa offset;
    // menafsirkannya sebagai UTC akan menggeser jam yang mereka ketik.
    expect(formatAnswerValue(field, '2026-08-09T14:30')).toBe('2026-08-09 14:30');
  });

  it('mengembalikan string kosong untuk field yang tidak diisi', () => {
    const field = buildField({ id: 'f_n', name: 'nama', type: 'text', label: 'Nama' });

    expect(formatAnswerValue(field, undefined)).toBe('');
    expect(formatAnswerValue(field, '')).toBe('');
  });
});

describe('describeAnswers', () => {
  const schema = buildSchema([
    { id: 'sec', name: 'bagian', type: 'section_heading', label: 'Bagian' },
    { id: 'f_nama', name: 'nama', type: 'text', label: 'Nama lengkap' },
    kelas,
  ]);

  it('mengembalikan semua field input dalam urutan form, tanpa section heading', () => {
    const entries = describeAnswers(schema, { f_nama: 'Sari' });

    expect(entries.map((entry) => entry.fieldId)).toEqual(['f_nama', 'f_kelas']);
  });

  it('menandai field yang tidak diisi tanpa membuangnya', () => {
    const entries = describeAnswers(schema, { f_nama: 'Sari' });

    expect(entries[1]).toMatchObject({ fieldId: 'f_kelas', answered: false, display: '' });
  });

  it('memakai label versi schema yang diberikan, bukan versi lain', () => {
    // Inti ARCHITECTURE.md bagian 6 poin 1: schema lama menghasilkan label lama.
    const versiLama = buildSchema([{ ...kelas, label: 'Kelas yang dipilih' }]);

    expect(describeAnswers(versiLama, { f_kelas: 'opt_dasar' })[0]).toMatchObject({
      label: 'Kelas yang dipilih',
      display: 'Kelas Dasar',
    });
  });

  it('tetap menampilkan jawaban yang fieldnya tidak ada di versi ini', () => {
    const entries = describeAnswers(schema, { f_nama: 'Sari', f_dihapus: 'nilai lama' });
    const orphan = entries.find((entry) => entry.fieldId === 'f_dihapus');

    expect(orphan).toMatchObject({ orphan: true, display: 'nilai lama', answered: true });
    // Diletakkan di akhir supaya urutan field yang sebenarnya tidak terganggu.
    expect(entries.at(-1)?.fieldId).toBe('f_dihapus');
  });
});
