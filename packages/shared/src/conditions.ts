import { z } from 'zod';

/**
 * Operator untuk rule show/hide. Rule disimpan per field (atau per opsi) dan
 * dievaluasi di dua sisi: client (untuk UX) dan server (untuk keamanan).
 * Lihat ARCHITECTURE.md bagian 6 poin 2.
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

export const conditionLogicSchema = z.enum(['AND', 'OR']);
export type ConditionLogic = z.infer<typeof conditionLogicSchema>;

export const conditionActionSchema = z.enum(['show', 'hide']);
export type ConditionAction = z.infer<typeof conditionActionSchema>;

/**
 * Satu rule perbandingan. `value` boleh berupa id opsi (untuk field select/radio),
 * string, angka, boolean, atau array untuk operator `in`/`not_in`.
 */
export const conditionRuleSchema = z.object({
  fieldId: z.string().min(1),
  /** Diisi kalau rule menargetkan opsi tertentu, bukan sekadar nilai field. */
  optionId: z.string().min(1).optional(),
  operator: conditionOperatorSchema,
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
      z.null(),
    ])
    .optional(),
});
export type ConditionRule = z.infer<typeof conditionRuleSchema>;

export const conditionGroupSchema = z.object({
  action: conditionActionSchema.default('show'),
  logic: conditionLogicSchema.default('AND'),
  rules: z.array(conditionRuleSchema).min(1),
});
export type ConditionGroup = z.infer<typeof conditionGroupSchema>;

/** Kumpulan kondisi yang menempel pada sebuah field atau opsi. */
export const conditionsSchema = z.object({
  visibility: conditionGroupSchema.optional(),
});
export type Conditions = z.infer<typeof conditionsSchema>;
