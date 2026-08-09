import { optionValue, type AnswerMap, type AnswerValue, type FormSchema } from '@formz/shared';

/**
 * Nilai awal form, diambil dari `defaultValue` tiap field.
 *
 * Field select/radio menyimpan `optionValue(option)` — sama persis dengan yang
 * dipakai form builder dan preview di dashboard, supaya rule kondisi yang dibuat
 * di builder cocok dengan jawaban yang dihasilkan renderer. `defaultValue` di
 * schema menunjuk id opsi, jadi diterjemahkan dulu di sini.
 */
export function initialAnswers(schema: FormSchema): AnswerMap {
  const answers: AnswerMap = {};

  for (const field of schema.fields) {
    if (field.type === 'section_heading' || field.type === 'file_upload') continue;

    const fallback = field.defaultValue;

    if (fallback === undefined) continue;

    switch (field.type) {
      case 'select':
      case 'radio': {
        const option = field.options.find((item) => item.id === fallback);
        answers[field.id] = option ? optionValue(option) : fallback;
        break;
      }

      case 'multiselect': {
        const selected = Array.isArray(fallback) ? fallback : [];
        answers[field.id] = selected.map((id) => {
          const option = field.options.find((item) => item.id === id);
          return option ? optionValue(option) : id;
        });
        break;
      }

      default:
        answers[field.id] = fallback;
    }
  }

  return answers;
}

/** Mengubah satu jawaban tanpa memutasi map yang lama (Preact butuh referensi baru). */
export function withAnswer(
  answers: AnswerMap,
  fieldId: string,
  value: AnswerValue | undefined,
): AnswerMap {
  const next = { ...answers };

  if (value === undefined) delete next[fieldId];
  else next[fieldId] = value;

  return next;
}

/** Menambah/membuang satu nilai pada field multiselect. */
export function toggleValue(current: AnswerValue | undefined, value: string): string[] {
  const list = Array.isArray(current) ? current : [];

  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
