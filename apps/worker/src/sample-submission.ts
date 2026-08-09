import { getInputFields, type AnswerMap, type FormField } from '@formz/shared';
import type { FormContext, SubmissionContext } from './db/queries';

/**
 * Jawaban contoh untuk job uji coba.
 *
 * Tombol "Test Kirim" harus bisa dipakai sebelum ada satu pun submission asli —
 * itulah gunanya. Isinya sengaja dibuat menyerupai jawaban sungguhan, bukan
 * string kosong, supaya yang terlihat di spreadsheet dan di email benar-benar
 * memperlihatkan bentuk akhirnya: lebar kolom, urutan, dan format tanggal.
 */

const SAMPLE_SUBMISSION_ID = '00000000-0000-0000-0000-000000000000';

export function buildSampleSubmission(form: FormContext, at: Date): SubmissionContext {
  return {
    submissionId: SAMPLE_SUBMISSION_ID,
    formId: form.formId,
    formTitle: form.formTitle,
    formKey: form.formKey,
    versionNumber: form.versionNumber,
    submittedAt: at,
    sourceDomain: 'uji-coba.formz.local',
    answers: sampleAnswers(form, at),
    schema: form.schema,
  };
}

/** Menandai submission contoh, dipakai template email untuk memberi label jelas. */
export function isSampleSubmission(context: SubmissionContext): boolean {
  return context.submissionId === SAMPLE_SUBMISSION_ID;
}

function sampleAnswers(form: FormContext, at: Date): AnswerMap {
  const answers: AnswerMap = {};

  for (const field of getInputFields(form.schema)) {
    const value = sampleValue(field, at);

    if (value !== undefined) answers[field.id] = value;
  }

  return answers;
}

function sampleValue(field: FormField, at: Date) {
  const isoDate = at.toISOString().slice(0, 10);

  switch (field.type) {
    case 'text':
      return `Contoh ${field.label.toLowerCase()}`;
    case 'textarea':
      return `Ini isian contoh untuk "${field.label}". Baris ini dikirim oleh tombol Test Kirim, bukan oleh pengisi form.`;
    case 'number':
      return 42;
    case 'email':
      return 'contoh@example.com';
    case 'phone':
      return '081234567890';
    case 'date':
      return isoDate;
    case 'datetime':
      return `${isoDate}T09:00`;
    case 'checkbox':
      return true;
    case 'select':
    case 'radio':
      // Id opsi, bukan labelnya — sama seperti yang dikirim form renderer.
      return field.options[0]?.id;
    case 'multiselect':
      return field.options.slice(0, 2).map((option) => option.id);
    case 'file_upload':
      // Unggah berkas belum tersedia (lihat catatan Part 5), jadi tidak ada
      // bentuk jawaban yang bisa dicontohkan tanpa mengarang.
      return undefined;
    default:
      return undefined;
  }
}
