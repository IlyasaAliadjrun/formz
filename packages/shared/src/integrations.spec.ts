import {
  extractSpreadsheetId,
  renderTemplateString,
  resolveRecipients,
  resolveSheetFields,
  shouldNotify,
} from './integrations';
import { formSchemaSchema, type FormSchema } from './form-schema';
import { googleSheetConfigSchema } from './integrations';

/**
 * Schema uji: satu select yang menentukan penerima tambahan, plus satu field
 * email milik pengisi form. Bentuknya sengaja mirip kasus nyata "kirim ke tim
 * tertentu kalau layanannya tertentu, dan balas juga ke pengisinya".
 */
const SCHEMA: FormSchema = formSchemaSchema.parse({
  version: 1,
  title: 'Pendaftaran',
  fields: [
    { id: 'f_nama', name: 'nama', type: 'text', label: 'Nama' },
    { id: 'f_email', name: 'email', type: 'email', label: 'Email' },
    {
      id: 'f_layanan',
      name: 'layanan',
      type: 'select',
      label: 'Layanan',
      options: [
        { id: 'opt_konsultasi', label: 'Konsultasi' },
        { id: 'opt_implementasi', label: 'Implementasi' },
      ],
    },
    {
      id: 'f_durasi',
      name: 'durasi',
      type: 'number',
      label: 'Durasi',
      conditions: {
        visibility: {
          action: 'show',
          logic: 'AND',
          rules: [{ fieldId: 'f_layanan', operator: 'equals', value: 'opt_implementasi' }],
        },
      },
    },
  ],
});

const SALES_RULE = {
  condition: {
    action: 'show' as const,
    logic: 'AND' as const,
    rules: [{ fieldId: 'f_layanan', operator: 'equals' as const, value: 'opt_implementasi' }],
  },
  recipients: ['sales@example.com'],
};

describe('extractSpreadsheetId', () => {
  it('mengambil id dari URL yang di-copy dari address bar', () => {
    expect(
      extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=0'),
    ).toBe('1AbC-dEf_123');
  });

  it('membiarkan id mentah apa adanya', () => {
    expect(extractSpreadsheetId('  1AbC-dEf_123  ')).toBe('1AbC-dEf_123');
  });
});

describe('resolveRecipients', () => {
  const base = { recipients: ['panitia@example.com'], recipientFieldIds: [], recipientRules: null };

  it('menggabungkan email tetap, field pengisi, dan aturan bersyarat', () => {
    const result = resolveRecipients(
      {
        recipients: ['panitia@example.com'],
        recipientFieldIds: ['f_email'],
        recipientRules: { rules: [SALES_RULE] },
      },
      SCHEMA,
      { f_email: 'Budi@Example.com', f_layanan: 'opt_implementasi' },
    );

    // Sekaligus memastikan alamatnya dinormalkan jadi huruf kecil.
    expect(result).toEqual(['budi@example.com', 'panitia@example.com', 'sales@example.com']);
  });

  it('melewatkan aturan bersyarat yang kondisinya tidak terpenuhi', () => {
    const result = resolveRecipients({ ...base, recipientRules: { rules: [SALES_RULE] } }, SCHEMA, {
      f_layanan: 'opt_konsultasi',
    });

    expect(result).toEqual(['panitia@example.com']);
  });

  it('membuang jawaban yang bukan email alih-alih menggagalkan seluruh pengiriman', () => {
    const result = resolveRecipients({ ...base, recipientFieldIds: ['f_email'] }, SCHEMA, {
      f_email: 'bukan email',
    });

    expect(result).toEqual(['panitia@example.com']);
  });

  it('tidak mengembalikan alamat yang sama dua kali', () => {
    const result = resolveRecipients(
      { recipients: ['budi@example.com'], recipientFieldIds: ['f_email'], recipientRules: null },
      SCHEMA,
      { f_email: 'budi@example.com' },
    );

    expect(result).toEqual(['budi@example.com']);
  });
});

describe('shouldNotify', () => {
  it('mengirim untuk setiap submission kalau tanpa kondisi', () => {
    expect(shouldNotify(null, SCHEMA, {})).toBe(true);
  });

  it('mengikuti hasil evaluasi kondisi', () => {
    const condition = {
      action: 'show' as const,
      logic: 'AND' as const,
      rules: [{ fieldId: 'f_layanan', operator: 'equals' as const, value: 'opt_implementasi' }],
    };

    expect(shouldNotify(condition, SCHEMA, { f_layanan: 'opt_implementasi' })).toBe(true);
    expect(shouldNotify(condition, SCHEMA, { f_layanan: 'opt_konsultasi' })).toBe(false);
  });

  it('menganggap jawaban field tersembunyi sebagai tidak ada', () => {
    // f_durasi hanya tampil kalau layanannya "Implementasi". Jawaban yang
    // diselipkan untuk field tersembunyi tidak boleh memicu notifikasi.
    const condition = {
      action: 'show' as const,
      logic: 'AND' as const,
      rules: [{ fieldId: 'f_durasi', operator: 'is_not_empty' as const }],
    };

    expect(shouldNotify(condition, SCHEMA, { f_layanan: 'opt_konsultasi', f_durasi: 12 })).toBe(
      false,
    );
    expect(shouldNotify(condition, SCHEMA, { f_layanan: 'opt_implementasi', f_durasi: 12 })).toBe(
      true,
    );
  });
});

describe('renderTemplateString', () => {
  it('mengganti token yang dikenal', () => {
    expect(
      renderTemplateString('Baru: {{form}} dari {{nama}}', { form: 'Daftar', nama: 'Budi' }),
    ).toBe('Baru: Daftar dari Budi');
  });

  it('membiarkan token yang tidak dikenal apa adanya', () => {
    // Subjek yang masih memuat {{typo}} jauh lebih mudah ditelusuri daripada
    // subjek yang diam-diam kehilangan sepotong teks.
    expect(renderTemplateString('Halo {{typo}}', { form: 'Daftar' })).toBe('Halo {{typo}}');
  });
});

describe('resolveSheetFields', () => {
  const config = (overrides: Record<string, unknown> = {}) =>
    googleSheetConfigSchema.parse({ spreadsheetId: 'sheet-1', ...overrides });

  it('memakai seluruh field jawaban kalau daftarnya kosong', () => {
    expect(resolveSheetFields(SCHEMA, config()).map((field) => field.id)).toEqual([
      'f_nama',
      'f_email',
      'f_layanan',
      'f_durasi',
    ]);
  });

  it('mengikuti urutan yang dipilih, bukan urutan field di form', () => {
    const fields = resolveSheetFields(SCHEMA, config({ fieldIds: ['f_layanan', 'f_nama'] }));

    expect(fields.map((field) => field.id)).toEqual(['f_layanan', 'f_nama']);
  });

  it('melewati field yang sudah tidak ada di schema alih-alih menggagalkan sync', () => {
    const fields = resolveSheetFields(SCHEMA, config({ fieldIds: ['f_nama', 'f_sudah_dihapus'] }));

    expect(fields.map((field) => field.id)).toEqual(['f_nama']);
  });
});
