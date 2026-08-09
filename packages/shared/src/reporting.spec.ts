import { createField } from './form-schema';
import {
  buildFieldDistribution,
  hasDistribution,
  sharePercentage,
  summarizeIntegration,
} from './reporting';

const selectField = createField({
  id: 'f_layanan',
  name: 'layanan',
  type: 'select',
  label: 'Jenis Layanan',
  options: [
    { id: 'opt_1', label: 'Konsultasi' },
    { id: 'opt_2', label: 'Implementasi' },
  ],
});

const checkboxField = createField({
  id: 'f_setuju',
  name: 'setuju',
  type: 'checkbox',
  label: 'Setuju syarat & ketentuan',
});

const textField = createField({
  id: 'f_nama',
  name: 'nama',
  type: 'text',
  label: 'Nama lengkap',
});

describe('sharePercentage', () => {
  it('membulatkan ke satu angka di belakang koma', () => {
    expect(sharePercentage(1, 3)).toBe(33.3);
    expect(sharePercentage(2, 3)).toBe(66.7);
    expect(sharePercentage(1, 2)).toBe(50);
  });

  it('menghasilkan 0 kalau penyebutnya nol, bukan NaN', () => {
    expect(sharePercentage(0, 0)).toBe(0);
    expect(sharePercentage(5, 0)).toBe(0);
  });
});

describe('summarizeIntegration', () => {
  it('menjumlahkan ketiga status dan menghitung tingkat suksesnya', () => {
    const stat = summarizeIntegration('sheet', { success: 8, failed: 2 });

    expect(stat).toEqual({
      kind: 'sheet',
      total: 10,
      success: 8,
      failed: 2,
      pending: 0,
      successRate: 80,
    });
  });

  it('membedakan "belum ada catatan" dari "0% sukses"', () => {
    expect(summarizeIntegration('email', {}).successRate).toBeNull();
    expect(summarizeIntegration('email', { failed: 3 }).successRate).toBe(0);
  });
});

describe('hasDistribution', () => {
  it('hanya berlaku untuk field yang jawabannya berupa pilihan', () => {
    expect(hasDistribution('select')).toBe(true);
    expect(hasDistribution('multiselect')).toBe(true);
    expect(hasDistribution('radio')).toBe(true);
    expect(hasDistribution('checkbox')).toBe(true);
    expect(hasDistribution('text')).toBe(false);
    expect(hasDistribution('number')).toBe(false);
    expect(hasDistribution('section_heading')).toBe(false);
  });
});

describe('buildFieldDistribution', () => {
  it('mengembalikan null untuk field tanpa pilihan', () => {
    expect(buildFieldDistribution(textField, new Map(), 5, 5)).toBeNull();
  });

  it('memakai urutan opsi dari schema dan persen terhadap penjawab', () => {
    const distribution = buildFieldDistribution(
      selectField,
      new Map([
        ['opt_2', 3],
        ['opt_1', 1],
      ]),
      4,
      10,
    );

    expect(distribution?.respondents).toBe(4);
    expect(distribution?.options).toEqual([
      { optionId: 'opt_1', label: 'Konsultasi', count: 1, percentage: 25, orphan: false },
      { optionId: 'opt_2', label: 'Implementasi', count: 3, percentage: 75, orphan: false },
    ]);
  });

  it('menampilkan opsi yang tidak diisi siapa pun sebagai nol, bukan menghilangkannya', () => {
    const distribution = buildFieldDistribution(selectField, new Map([['opt_1', 2]]), 2, 2);

    expect(distribution?.options.map((option) => [option.label, option.count])).toEqual([
      ['Konsultasi', 2],
      ['Implementasi', 0],
    ]);
  });

  it('tetap menampilkan id opsi yang sudah dihapus dari schema, ditandai orphan', () => {
    const distribution = buildFieldDistribution(
      selectField,
      new Map([
        ['opt_1', 1],
        ['opt_lama', 4],
      ]),
      5,
      5,
    );

    expect(distribution?.options.at(-1)).toEqual({
      optionId: 'opt_lama',
      label: 'opt_lama',
      count: 4,
      percentage: 80,
      orphan: true,
    });
  });

  it('menjumlahkan jawaban yang tersimpan sebagai value maupun id opsi', () => {
    const field = createField({
      id: 'f_kelas',
      name: 'kelas',
      type: 'radio',
      label: 'Kelas',
      options: [{ id: 'opt_a', label: 'Dasar', value: 'dasar' }],
    });

    const distribution = buildFieldDistribution(
      field,
      new Map([
        ['opt_a', 2],
        ['dasar', 3],
      ]),
      5,
      5,
    );

    expect(distribution?.options).toEqual([
      { optionId: 'opt_a', label: 'Dasar', count: 5, percentage: 100, orphan: false },
    ]);
  });

  it('menghitung "Tidak" pada checkbox dari total submission, bukan dari penjawab', () => {
    // Kotak yang tidak dicentang tidak meninggalkan jejak apa pun di answers,
    // jadi hanya 3 dari 10 submission yang punya kunci field ini.
    const distribution = buildFieldDistribution(checkboxField, new Map([['true', 3]]), 3, 10);

    expect(distribution?.respondents).toBe(10);
    expect(distribution?.options).toEqual([
      { optionId: 'true', label: 'Ya', count: 3, percentage: 30, orphan: false },
      { optionId: 'false', label: 'Tidak', count: 7, percentage: 70, orphan: false },
    ]);
  });

  it('tidak menghasilkan jumlah negatif kalau cacah checkbox melebihi total', () => {
    const distribution = buildFieldDistribution(checkboxField, new Map([['true', 5]]), 5, 0);

    expect(distribution?.options[1]?.count).toBe(0);
  });
});
