import { z } from 'zod';

/**
 * Struktur conditional visibility.
 *
 * Bentuk yang disimpan mengikuti contoh di ARCHITECTURE.md bagian 3.4 — deklaratif
 * (`action` + `logic` + daftar `rules`), bukan JSON Logic mentah. Alasannya:
 * struktur deklaratif bisa dibaca-tulis langsung oleh condition builder visual,
 * sedangkan JSON Logic mentah tidak (pohon `{"and":[{"==":[...]}]}` sulit dipetakan
 * balik ke baris-baris UI).
 *
 * Untuk portabilitas, `toJsonLogic()` di bawah mengonversi struktur ini ke JSON Logic
 * asli — dipakai kalau rule perlu dievaluasi oleh mesin lain (json-logic-js di
 * frontend, atau engine di luar Node).
 */
export const CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'is_empty',
  'is_not_empty',
  'in',
  'not_in',
] as const;

export const conditionOperatorSchema = z.enum(CONDITION_OPERATORS);
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

/** Operator yang tidak memakai `value` sama sekali. */
export const VALUELESS_OPERATORS = ['is_empty', 'is_not_empty'] as const;

/** Operator yang `value`-nya harus berupa array. */
export const ARRAY_VALUE_OPERATORS = ['in', 'not_in'] as const;

export const conditionLogicSchema = z.enum(['AND', 'OR']);
export type ConditionLogic = z.infer<typeof conditionLogicSchema>;

export const conditionActionSchema = z.enum(['show', 'hide']);
export type ConditionAction = z.infer<typeof conditionActionSchema>;

export const conditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
  z.null(),
]);
export type ConditionValue = z.infer<typeof conditionValueSchema>;

/**
 * Satu rule perbandingan.
 *
 * `fieldId` menunjuk field lain di form yang sama. Untuk field select/radio/multiselect,
 * `value` berisi **id opsi** (bukan label-nya), sehingga rule tetap benar walau
 * label opsinya nanti diubah.
 */
export const conditionRuleSchema = z.object({
  fieldId: z.string().min(1),
  operator: conditionOperatorSchema,
  value: conditionValueSchema.optional(),
});
export type ConditionRule = z.infer<typeof conditionRuleSchema>;

export const conditionGroupSchema = z.object({
  /** `show` = tampil kalau rule terpenuhi; `hide` = sembunyi kalau rule terpenuhi. */
  action: conditionActionSchema.default('show'),
  logic: conditionLogicSchema.default('AND'),
  rules: z.array(conditionRuleSchema).min(1),
});
export type ConditionGroup = z.infer<typeof conditionGroupSchema>;

/**
 * Kumpulan kondisi yang menempel pada sebuah field atau opsi.
 * Dibungkus objek supaya nanti bisa ditambah jenis kondisi lain
 * (misal `readOnly` atau `required`) tanpa mengubah bentuk data yang sudah tersimpan.
 */
export const conditionsSchema = z.object({
  visibility: conditionGroupSchema.optional(),
});
export type Conditions = z.infer<typeof conditionsSchema>;

// ---------------------------------------------------------------------------
// Konversi ke JSON Logic
// ---------------------------------------------------------------------------

export type JsonLogic = Record<string, unknown>;

/**
 * Mengonversi satu rule ke ekspresi JSON Logic.
 *
 * `starts_with` dan `ends_with` tidak ada di spesifikasi JSON Logic standar dan
 * dikeluarkan sebagai operator kustom dengan nama yang sama — mesin evaluator
 * perlu mendaftarkannya sendiri.
 */
export function ruleToJsonLogic(rule: ConditionRule): JsonLogic {
  const field = { var: rule.fieldId };
  const value = rule.value ?? null;

  switch (rule.operator) {
    case 'equals':
      return { '==': [field, value] };
    case 'not_equals':
      return { '!=': [field, value] };
    case 'contains':
      return { in: [value, field] };
    case 'not_contains':
      return { '!': { in: [value, field] } };
    case 'starts_with':
      return { startsWith: [field, value] };
    case 'ends_with':
      return { endsWith: [field, value] };
    case 'greater_than':
      return { '>': [field, value] };
    case 'greater_than_or_equal':
      return { '>=': [field, value] };
    case 'less_than':
      return { '<': [field, value] };
    case 'less_than_or_equal':
      return { '<=': [field, value] };
    case 'is_empty':
      return { '!': field };
    case 'is_not_empty':
      return { '!!': field };
    case 'in':
      return { in: [field, value] };
    case 'not_in':
      return { '!': { in: [field, value] } };
  }
}

/** Mengonversi satu grup kondisi ke JSON Logic. */
export function groupToJsonLogic(group: ConditionGroup): JsonLogic {
  const expressions = group.rules.map(ruleToJsonLogic);
  const combined: JsonLogic =
    expressions.length === 1
      ? (expressions[0] as JsonLogic)
      : { [group.logic === 'AND' ? 'and' : 'or']: expressions };

  // `hide` = kebalikan dari hasil rule-nya, supaya ekspresi yang dihasilkan
  // selalu berarti "apakah elemen ini terlihat".
  return group.action === 'hide' ? { '!': combined } : combined;
}

/** Mengembalikan ekspresi JSON Logic "apakah elemen ini terlihat", atau null kalau tanpa kondisi. */
export function conditionsToJsonLogic(conditions: Conditions | undefined): JsonLogic | null {
  if (!conditions?.visibility) return null;

  return groupToJsonLogic(conditions.visibility);
}
