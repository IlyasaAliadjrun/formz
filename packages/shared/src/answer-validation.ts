import { z } from 'zod';
import { evaluateConditions, getEffectiveAnswers, type AnswerMap } from './condition-evaluator';
import { hasOptions, optionValue, type FormField, type FormSchema } from './form-schema';
import type { AnswerValue } from './submission';

/**
 * Validasi jawaban terhadap aturan validasi yang tersimpan di schema form.
 *
 * Ditaruh di packages/shared karena dipakai dua kali untuk hal yang berbeda:
 *
 * - **form renderer (embed)** — memberi pesan error sebelum submit, supaya pengisi
 *   tidak perlu menunggu bolak-balik ke server
 * - **API** — memvalidasi ulang saat submit, karena validasi di client hanya soal
 *   kenyamanan dan bisa dilewati siapa pun yang memanggil endpoint langsung
 *
 * Yang divalidasi hanyalah jawaban untuk field yang **terlihat**. Field tersembunyi
 * dibuang lebih dulu lewat `getEffectiveAnswers`, jadi aturan `required` pada field
 * yang sedang disembunyikan kondisi tidak pernah menghalangi submit.
 */

export type AnswerIssueCode =
  | 'required'
  | 'invalid_type'
  | 'too_short'
  | 'too_long'
  | 'too_small'
  | 'too_large'
  | 'not_integer'
  | 'invalid_email'
  | 'invalid_pattern'
  | 'invalid_date'
  | 'date_too_early'
  | 'date_too_late'
  | 'too_few_selected'
  | 'too_many_selected'
  | 'unknown_option';

export interface AnswerIssue {
  fieldId: string;
  /** Nama field (bukan id) supaya pesan error enak dibaca di log & respons API. */
  fieldName: string;
  code: AnswerIssueCode;
  message: string;
}

export interface AnswerValidationResult {
  valid: boolean;
  errors: AnswerIssue[];
  /**
   * Jawaban yang sudah dibersihkan: field tersembunyi dan opsi tersembunyi dibuang.
   * Inilah yang disimpan server, bukan payload mentah dari request.
   */
  answers: AnswerMap;
}

/** Regex `pattern` dari schema dikompilasi sekali per proses, bukan tiap jawaban. */
const patternCache = new Map<string, RegExp | null>();

export function validateAnswers(schema: FormSchema, rawAnswers: AnswerMap): AnswerValidationResult {
  const evaluation = evaluateConditions(schema, rawAnswers);
  const answers = getEffectiveAnswers(schema, rawAnswers);
  const errors: AnswerIssue[] = [];

  for (const field of schema.fields) {
    if (field.type === 'section_heading') continue;
    if (!evaluation.fields[field.id]?.visible) continue;

    const value = answers[field.id];

    // Nilai yang ada di payload tapi hilang setelah pembersihan berarti opsi yang
    // dipilih tidak dikenal atau sedang tersembunyi — layak dilaporkan, bukan
    // didiamkan, supaya salah konfigurasi ketahuan alih-alih jadi jawaban kosong.
    if (value === undefined && hasOptions(field) && isNonEmpty(rawAnswers[field.id])) {
      errors.push(
        issue(
          field,
          'unknown_option',
          `Pilihan pada "${field.label}" tidak dikenal atau tidak tersedia`,
        ),
      );
      continue;
    }

    errors.push(...validateAnswer(field, value));
  }

  return { valid: errors.length === 0, errors, answers };
}

/**
 * Memeriksa satu jawaban. Dipakai renderer untuk validasi saat field ditinggalkan
 * (on blur), tanpa perlu mengevaluasi seluruh form.
 */
export function validateAnswer(field: FormField, value: AnswerValue | undefined): AnswerIssue[] {
  if (field.type === 'section_heading') return [];

  // Unggah berkas belum aktif (lihat catatan Part 5 di PROGRESS.md), jadi aturannya
  // belum ditegakkan — kalau ditegakkan sekarang, field wajib jadi jalan buntu.
  if (field.type === 'file_upload') return [];

  const errors: AnswerIssue[] = [];
  const custom = field.validation.errorMessage;

  const push = (code: AnswerIssueCode, message: string): void => {
    errors.push(issue(field, code, custom ?? message));
  };

  if (!isNonEmpty(value)) {
    if (field.validation.required) {
      push('required', requiredMessage(field));
    }

    // Tanpa isi, tidak ada lagi yang bisa diperiksa.
    return errors;
  }

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'phone': {
      if (typeof value !== 'string') {
        push('invalid_type', `"${field.label}" harus berupa teks`);
        break;
      }

      checkLength(value, field.validation, push, field.label);

      const { pattern } = field.validation as { pattern?: string };

      if (pattern) {
        const regex = compilePattern(pattern);
        if (regex && !regex.test(value)) {
          push('invalid_pattern', `Format "${field.label}" belum sesuai`);
        }
      }
      break;
    }

    case 'email': {
      if (typeof value !== 'string') {
        push('invalid_type', `"${field.label}" harus berupa teks`);
        break;
      }

      checkLength(value, field.validation, push, field.label);

      if (!z.email().safeParse(value).success) {
        push('invalid_email', `"${field.label}" bukan alamat email yang valid`);
      }
      break;
    }

    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(value);

      if (typeof value === 'boolean' || Array.isArray(value) || Number.isNaN(numeric)) {
        push('invalid_type', `"${field.label}" harus berupa angka`);
        break;
      }

      const { integerOnly, min, max } = field.validation;

      if (integerOnly && !Number.isInteger(numeric)) {
        push('not_integer', `"${field.label}" harus bilangan bulat`);
      }
      if (min !== undefined && numeric < min) {
        push('too_small', `"${field.label}" minimal ${min}`);
      }
      if (max !== undefined && numeric > max) {
        push('too_large', `"${field.label}" maksimal ${max}`);
      }
      break;
    }

    case 'date':
    case 'datetime': {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        push('invalid_date', `"${field.label}" bukan tanggal yang valid`);
        break;
      }

      const time = Date.parse(value);
      const { minDate, maxDate } = field.validation;

      if (minDate) {
        const min = Date.parse(minDate);
        if (!Number.isNaN(min) && time < min) {
          push('date_too_early', `"${field.label}" tidak boleh sebelum ${minDate}`);
        }
      }
      if (maxDate) {
        const max = Date.parse(maxDate);
        if (!Number.isNaN(max) && time > max) {
          push('date_too_late', `"${field.label}" tidak boleh setelah ${maxDate}`);
        }
      }
      break;
    }

    case 'select':
    case 'radio': {
      if (typeof value !== 'string' || !allowedValues(field).has(value)) {
        push('unknown_option', `Pilihan pada "${field.label}" tidak dikenal`);
      }
      break;
    }

    case 'multiselect': {
      if (!Array.isArray(value)) {
        push('invalid_type', `"${field.label}" harus berupa daftar pilihan`);
        break;
      }

      const allowed = allowedValues(field);
      const { minSelected, maxSelected } = field.validation;

      if (value.some((item) => !allowed.has(item))) {
        push('unknown_option', `Ada pilihan pada "${field.label}" yang tidak dikenal`);
      }
      if (minSelected !== undefined && value.length < minSelected) {
        push('too_few_selected', `Pilih minimal ${minSelected} pada "${field.label}"`);
      }
      if (maxSelected !== undefined && value.length > maxSelected) {
        push('too_many_selected', `Pilih maksimal ${maxSelected} pada "${field.label}"`);
      }
      break;
    }

    case 'checkbox': {
      if (typeof value !== 'boolean') {
        push('invalid_type', `"${field.label}" harus berupa true atau false`);
      }
      break;
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Checkbox tidak dicentang (`false`), string kosong, dan array kosong sama-sama
 * dihitung "belum diisi" — persis seperti `is_empty` di evaluator kondisi, supaya
 * satu jawaban tidak bisa dianggap kosong oleh yang satu dan terisi oleh yang lain.
 */
function isNonEmpty(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null || value === '' || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;

  return true;
}

function requiredMessage(field: FormField): string {
  if (field.type === 'checkbox') return `"${field.label}" harus dicentang`;
  if (field.type === 'select' || field.type === 'radio' || field.type === 'multiselect') {
    return `"${field.label}" wajib dipilih`;
  }

  return `"${field.label}" wajib diisi`;
}

function checkLength(
  value: string,
  validation: { minLength?: number; maxLength?: number },
  push: (code: AnswerIssueCode, message: string) => void,
  label: string,
): void {
  if (validation.minLength !== undefined && value.length < validation.minLength) {
    push('too_short', `"${label}" minimal ${validation.minLength} karakter`);
  }
  if (validation.maxLength !== undefined && value.length > validation.maxLength) {
    push('too_long', `"${label}" maksimal ${validation.maxLength} karakter`);
  }
}

/** Opsi boleh dikirim sebagai id maupun `value`-nya — keduanya diterima. */
function allowedValues(field: FormField): Set<string> {
  if (!hasOptions(field)) return new Set();

  return new Set(field.options.flatMap((option) => [option.id, optionValue(option)]));
}

/**
 * Regex dari schema berasal dari admin, bukan pengisi form, tapi tetap dikompilasi
 * di dalam try/catch: pola yang tidak valid tidak boleh membuat submit gagal total.
 */
function compilePattern(pattern: string): RegExp | null {
  const cached = patternCache.get(pattern);
  if (cached !== undefined) return cached;

  let compiled: RegExp | null = null;

  try {
    compiled = new RegExp(pattern);
  } catch {
    compiled = null;
  }

  patternCache.set(pattern, compiled);

  return compiled;
}

function issue(field: FormField, code: AnswerIssueCode, message: string): AnswerIssue {
  return { fieldId: field.id, fieldName: field.name, code, message };
}
