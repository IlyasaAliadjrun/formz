import { hasOptions, optionValue, type FormField, type FormSchema } from './form-schema';
import type { AnswerMap } from './condition-evaluator';
import type { AnswerValue } from './submission';

/**
 * Mengubah jawaban mentah menjadi teks yang bisa dibaca manusia.
 *
 * Ditaruh di packages/shared karena dipakai tiga tempat yang wajib menampilkan
 * hal yang sama: halaman detail submission, ekspor Excel/CSV, dan nanti isi
 * email notifikasi di Part 8. Kalau ketiganya punya salinan sendiri, cepat atau
 * lambat ada yang menampilkan `opt_2` sementara yang lain menampilkan
 * "Implementasi" — dan yang salah tidak akan ketahuan sampai ada yang protes.
 *
 * Jawaban selalu diterjemahkan memakai schema **versi submission itu**, bukan
 * versi form terbaru (ARCHITECTURE.md bagian 6 poin 1).
 */

export interface AnswerEntry {
  fieldId: string;
  /** Nama field — dipakai sebagai header kolom di ekspor. */
  name: string;
  label: string;
  type: string;
  value: AnswerValue | undefined;
  /** Teks siap tampil. String kosong kalau field memang tidak diisi. */
  display: string;
  answered: boolean;
  /**
   * True kalau jawaban ini tidak punya field di schema versi tersebut. Bisa
   * terjadi kalau data lama dipindahkan atau schema diubah manual di database.
   */
  orphan: boolean;
}

/** Teks untuk checkbox, dipakai juga oleh ekspor supaya kolomnya konsisten. */
export const CHECKBOX_YES = 'Ya';
export const CHECKBOX_NO = 'Tidak';

/**
 * Semua field input pada satu versi schema beserta jawabannya, dalam urutan
 * field di form. Field yang tidak diisi tetap ikut supaya pembaca detail
 * submission tahu bedanya "tidak diisi" dengan "tidak pernah ada field ini".
 */
export function describeAnswers(schema: FormSchema, answers: AnswerMap): AnswerEntry[] {
  const entries: AnswerEntry[] = [];
  const known = new Set<string>();

  for (const field of schema.fields) {
    if (field.type === 'section_heading') continue;

    known.add(field.id);

    const value = answers[field.id];

    entries.push({
      fieldId: field.id,
      name: field.name,
      label: field.label,
      type: field.type,
      value,
      display: formatAnswerValue(field, value),
      answered: isAnswered(value),
      orphan: false,
    });
  }

  // Jawaban tanpa field pasangannya diletakkan di akhir, bukan dibuang —
  // menyembunyikannya akan membuat data yang benar-benar ada jadi tak terlihat.
  for (const [fieldId, value] of Object.entries(answers)) {
    if (known.has(fieldId)) continue;

    entries.push({
      fieldId,
      name: fieldId,
      label: fieldId,
      type: 'unknown',
      value,
      display: stringify(value),
      answered: isAnswered(value),
      orphan: true,
    });
  }

  return entries;
}

/** Teks satu jawaban sesuai tipe field-nya. */
export function formatAnswerValue(field: FormField, value: AnswerValue | undefined): string {
  if (!isAnswered(value)) {
    // Checkbox tidak punya keadaan "kosong": tidak dicentang adalah jawaban yang
    // sah. Renderer juga membuang `false` dari payload, jadi kotak yang tidak
    // disentuh tiba sebagai undefined — keduanya berarti hal yang sama, dan sel
    // kosong di kolom checkbox akan terbaca seperti data yang hilang.
    return field.type === 'checkbox' ? CHECKBOX_NO : '';
  }

  if (field.type === 'checkbox') {
    return value === true ? CHECKBOX_YES : CHECKBOX_NO;
  }

  if (hasOptions(field)) {
    const values = Array.isArray(value) ? value : [value];

    return values.map((item) => optionLabel(field, item)).join(', ');
  }

  if (field.type === 'datetime' && typeof value === 'string') {
    return formatDateTimeValue(value);
  }

  return stringify(value);
}

/**
 * Label opsi berdasarkan nilai tersimpan. Cocok dengan `id` maupun `value`,
 * karena keduanya diterima saat submit.
 */
function optionLabel(field: FormField, value: AnswerValue): string {
  if (!hasOptions(field)) return stringify(value);

  const raw = stringify(value);
  const option = field.options.find((item) => item.id === raw || optionValue(item) === raw);

  // Opsi yang sudah dihapus dari schema tetap ditampilkan apa adanya — lebih
  // berguna daripada sel kosong tanpa keterangan.
  return option ? option.label : raw;
}

/**
 * `2026-08-09T14:30` → `2026-08-09 14:30`.
 *
 * Sengaja tidak memakai `Intl`/timezone: nilai dari input `datetime-local`
 * adalah waktu lokal pengisi form tanpa offset, jadi mengonversinya seolah UTC
 * justru menggeser jam yang sebenarnya diketik orang.
 */
function formatDateTimeValue(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);

  return match ? `${match[1]} ${match[2]}` : value;
}

/** Predikat tipe, supaya cabang "sudah diisi" tidak lagi mengandung undefined. */
function isAnswered(value: AnswerValue | undefined): value is AnswerValue {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;

  return true;
}

function stringify(value: AnswerValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');

  return String(value);
}
