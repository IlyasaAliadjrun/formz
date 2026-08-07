import type { ConditionGroup, ConditionRule, ConditionValue } from './conditions';
import { hasOptions, optionValue, type FormField, type FormSchema } from './form-schema';
import type { AnswerValue } from './submission';

/**
 * Evaluator conditional visibility.
 *
 * Sengaja ditaruh di packages/shared dan ditulis tanpa dependensi apa pun, supaya
 * potongan kode yang sama persis dipakai di dua tempat yang wajib sepakat:
 *
 * - **form renderer (embed)** — menyembunyikan field secara real-time saat diisi
 * - **API** — memvalidasi ulang saat submit, supaya orang tidak bisa mengirim
 *   jawaban untuk field yang seharusnya tersembunyi (ARCHITECTURE.md bagian 6 poin 2)
 *
 * Kalau logika ini diduplikasi di dua repo, cepat atau lambat keduanya menyimpang
 * dan celah keamanan di poin kedua terbuka.
 */

export type AnswerMap = Record<string, AnswerValue | undefined>;

export interface FieldVisibility {
  visible: boolean;
  /** Id opsi yang terlihat. Kosong untuk field tanpa opsi. */
  visibleOptionIds: string[];
  hiddenOptionIds: string[];
}

export interface ConditionEvaluationResult {
  /** Status visibilitas per field, dikunci dengan field id. */
  fields: Record<string, FieldVisibility>;
  visibleFieldIds: string[];
  hiddenFieldIds: string[];
  /**
   * Terisi kalau ada rantai kondisi melingkar (A bergantung B, B bergantung A).
   * Evaluasi tetap menghasilkan jawaban, tapi hasilnya diambil dari iterasi terakhir.
   */
  cyclicFieldIds: string[];
}

/** Batas iterasi kalau ada siklus; nilainya cukup untuk rantai kondisi terdalam sekalipun. */
const MAX_PASSES = 50;

/**
 * Menghitung field dan opsi mana yang terlihat untuk sekumpulan jawaban.
 *
 * Evaluasinya berulang sampai stabil, karena visibilitas bisa berantai: kalau field A
 * menyembunyikan field B, maka jawaban B dianggap kosong dan field C yang bergantung
 * pada B ikut berubah. Sekali jalan saja akan salah untuk rantai seperti ini.
 */
export function evaluateConditions(
  schema: FormSchema,
  currentAnswers: AnswerMap = {},
): ConditionEvaluationResult {
  const fields = schema.fields;

  // Asumsi awal: semua terlihat. Iterasi berikutnya menyempitkannya.
  let visibleFields = new Set(fields.map((field) => field.id));
  let passes = 0;
  let stable = false;

  while (!stable && passes < MAX_PASSES) {
    const next = new Set<string>();

    for (const field of fields) {
      if (isVisible(field.conditions?.visibility, currentAnswers, visibleFields)) {
        next.add(field.id);
      }
    }

    stable = setsEqual(next, visibleFields);
    visibleFields = next;
    passes += 1;
  }

  const cyclicFieldIds = stable
    ? []
    : fields.map((field) => field.id).filter((id) => hasSelfReferentialChain(schema, id));

  const result: Record<string, FieldVisibility> = {};

  for (const field of fields) {
    const fieldVisible = visibleFields.has(field.id);
    const visibleOptionIds: string[] = [];
    const hiddenOptionIds: string[] = [];

    if (hasOptions(field)) {
      for (const option of field.options) {
        // Opsi dari field yang tersembunyi ikut tersembunyi, tanpa perlu cek rule-nya.
        const optionVisible =
          fieldVisible && isVisible(option.conditions?.visibility, currentAnswers, visibleFields);

        if (optionVisible) visibleOptionIds.push(option.id);
        else hiddenOptionIds.push(option.id);
      }
    }

    result[field.id] = { visible: fieldVisible, visibleOptionIds, hiddenOptionIds };
  }

  return {
    fields: result,
    visibleFieldIds: fields.filter((f) => visibleFields.has(f.id)).map((f) => f.id),
    hiddenFieldIds: fields.filter((f) => !visibleFields.has(f.id)).map((f) => f.id),
    cyclicFieldIds,
  };
}

export function isFieldVisible(result: ConditionEvaluationResult, fieldId: string): boolean {
  return result.fields[fieldId]?.visible ?? false;
}

export function isOptionVisible(
  result: ConditionEvaluationResult,
  fieldId: string,
  optionId: string,
): boolean {
  return result.fields[fieldId]?.visibleOptionIds.includes(optionId) ?? false;
}

/**
 * Membuang jawaban yang seharusnya tidak ada: field yang tersembunyi, dan opsi
 * tersembunyi pada field multiselect.
 *
 * Ini yang dipakai server saat submit — jawaban untuk field tersembunyi dibuang
 * diam-diam alih-alih ditolak, karena bisa saja pengisi sempat mengisinya lalu
 * mengubah jawaban di atasnya sehingga field tersebut tersembunyi.
 */
export function getEffectiveAnswers(schema: FormSchema, answers: AnswerMap): AnswerMap {
  const evaluation = evaluateConditions(schema, answers);
  const effective: AnswerMap = {};

  for (const field of schema.fields) {
    const visibility = evaluation.fields[field.id];

    if (!visibility?.visible) continue;
    if (field.type === 'section_heading') continue;

    const answer = answers[field.id];
    if (answer === undefined) continue;

    if (hasOptions(field) && Array.isArray(answer)) {
      const allowed = new Set(
        field.options
          .filter((option) => visibility.visibleOptionIds.includes(option.id))
          .flatMap((option) => [option.id, optionValue(option)]),
      );
      effective[field.id] = answer.filter((item) => allowed.has(item));
      continue;
    }

    if (hasOptions(field) && typeof answer === 'string') {
      const allowed = new Set(
        field.options
          .filter((option) => visibility.visibleOptionIds.includes(option.id))
          .flatMap((option) => [option.id, optionValue(option)]),
      );
      if (!allowed.has(answer)) continue;
    }

    effective[field.id] = answer;
  }

  return effective;
}

// ---------------------------------------------------------------------------
// Evaluasi rule
// ---------------------------------------------------------------------------

function isVisible(
  group: ConditionGroup | undefined,
  answers: AnswerMap,
  visibleFields: ReadonlySet<string>,
): boolean {
  // Tanpa kondisi = selalu terlihat.
  if (!group) return true;

  const results = group.rules.map((rule) => matchesRule(rule, answers, visibleFields));
  const matched = group.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);

  return group.action === 'hide' ? !matched : matched;
}

function matchesRule(
  rule: ConditionRule,
  answers: AnswerMap,
  visibleFields: ReadonlySet<string>,
): boolean {
  // Jawaban dari field yang sedang tersembunyi dianggap tidak ada — inilah yang
  // membuat rantai kondisi ikut runtuh saat field di atasnya disembunyikan.
  const answer = visibleFields.has(rule.fieldId) ? answers[rule.fieldId] : undefined;

  switch (rule.operator) {
    case 'is_empty':
      return isEmptyAnswer(answer);
    case 'is_not_empty':
      return !isEmptyAnswer(answer);
    case 'equals':
      return answerEquals(answer, rule.value);
    case 'not_equals':
      return !answerEquals(answer, rule.value);
    case 'contains':
      return answerContains(answer, rule.value);
    case 'not_contains':
      return !answerContains(answer, rule.value);
    case 'starts_with':
      return typeof answer === 'string' && answer.startsWith(String(rule.value ?? ''));
    case 'ends_with':
      return typeof answer === 'string' && answer.endsWith(String(rule.value ?? ''));
    case 'greater_than':
      return compareAnswer(answer, rule.value, (a, b) => a > b);
    case 'greater_than_or_equal':
      return compareAnswer(answer, rule.value, (a, b) => a >= b);
    case 'less_than':
      return compareAnswer(answer, rule.value, (a, b) => a < b);
    case 'less_than_or_equal':
      return compareAnswer(answer, rule.value, (a, b) => a <= b);
    case 'in':
      return answerIn(answer, rule.value);
    case 'not_in':
      return !answerIn(answer, rule.value);
  }
}

/** Checkbox yang tidak dicentang dan array kosong sama-sama dihitung kosong. */
function isEmptyAnswer(answer: AnswerValue | undefined): boolean {
  if (answer === undefined || answer === null || answer === '') return true;
  if (answer === false) return true;
  if (Array.isArray(answer)) return answer.length === 0;

  return false;
}

/**
 * Perbandingan yang memaafkan beda tipe antara string dan angka, karena input
 * HTML selalu menghasilkan string sementara rule bisa saja menyimpan angka.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;

  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return String(a) === String(b);
  }

  const numA = Number(a);
  const numB = Number(b);

  if (!Number.isNaN(numA) && !Number.isNaN(numB) && a !== '' && b !== '') {
    return numA === numB;
  }

  return String(a) === String(b);
}

/** Untuk field multi-nilai, `equals` berarti "salah satu jawabannya sama dengan nilai ini". */
function answerEquals(answer: AnswerValue | undefined, value: ConditionValue | undefined): boolean {
  if (Array.isArray(answer)) {
    return answer.some((item) => looseEquals(item, value));
  }

  return looseEquals(answer, value);
}

function answerContains(
  answer: AnswerValue | undefined,
  value: ConditionValue | undefined,
): boolean {
  if (Array.isArray(answer)) {
    return answer.some((item) => looseEquals(item, value));
  }

  if (typeof answer === 'string') {
    return answer.includes(String(value ?? ''));
  }

  return false;
}

function answerIn(answer: AnswerValue | undefined, value: ConditionValue | undefined): boolean {
  if (!Array.isArray(value)) return false;

  if (Array.isArray(answer)) {
    return answer.some((item) => value.some((candidate) => looseEquals(item, candidate)));
  }

  return value.some((candidate) => looseEquals(answer, candidate));
}

/**
 * Perbandingan besar-kecil. Angka dibandingkan sebagai angka, tanggal ISO sebagai
 * tanggal, sisanya sebagai string.
 */
function compareAnswer(
  answer: AnswerValue | undefined,
  value: ConditionValue | undefined,
  compare: (a: number | string, b: number | string) => boolean,
): boolean {
  if (answer === undefined || answer === null || value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(answer) || Array.isArray(value)) return false;

  const numA = Number(answer);
  const numB = Number(value);

  if (!Number.isNaN(numA) && !Number.isNaN(numB) && answer !== '' && value !== '') {
    return compare(numA, numB);
  }

  const dateA = Date.parse(String(answer));
  const dateB = Date.parse(String(value));

  if (!Number.isNaN(dateA) && !Number.isNaN(dateB)) {
    return compare(dateA, dateB);
  }

  return compare(String(answer), String(value));
}

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;

  for (const item of a) {
    if (!b.has(item)) return false;
  }

  return true;
}

/** Menelusuri rantai ketergantungan kondisi untuk mendeteksi siklus. */
function hasSelfReferentialChain(schema: FormSchema, startId: string): boolean {
  const seen = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const field = schema.fields.find((f) => f.id === current);

    for (const dependency of dependenciesOf(field)) {
      if (dependency === startId) return true;
      if (seen.has(dependency)) continue;

      seen.add(dependency);
      queue.push(dependency);
    }
  }

  return false;
}

/** Field-field yang dirujuk oleh kondisi sebuah field (termasuk kondisi di opsinya). */
export function dependenciesOf(field: FormField | undefined): string[] {
  if (!field) return [];

  const fromField = field.conditions?.visibility?.rules.map((rule) => rule.fieldId) ?? [];
  const fromOptions = hasOptions(field)
    ? field.options.flatMap(
        (option) => option.conditions?.visibility?.rules.map((rule) => rule.fieldId) ?? [],
      )
    : [];

  return [...new Set([...fromField, ...fromOptions])];
}
