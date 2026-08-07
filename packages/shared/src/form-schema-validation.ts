import { VALUELESS_OPERATORS, ARRAY_VALUE_OPERATORS, type ConditionGroup } from './conditions';
import { dependenciesOf } from './condition-evaluator';
import {
  formSchemaSchema,
  hasOptions,
  isInputFormField,
  optionValue,
  type FormField,
  type FormSchema,
} from './form-schema';

/**
 * Validasi integritas schema form.
 *
 * Berbeda dengan `formSchemaSchema.parse()` yang hanya memeriksa **bentuk** data,
 * fungsi ini memeriksa **konsistensi antar bagian**: id yang dobel, rule kondisi
 * yang menunjuk field tidak ada, siklus, dan sejenisnya. Dipanggil sebelum publish.
 */

export interface SchemaIssue {
  /** Lokasi masalah, misal `fields[2].conditions.visibility.rules[0].fieldId`. */
  path: string;
  message: string;
  /** Kode mesin-dibaca supaya UI builder bisa menyorot elemen yang bermasalah. */
  code: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  /** Menghalangi publish. */
  errors: SchemaIssue[];
  /** Tidak menghalangi publish, tapi hampir selalu menandakan salah susun. */
  warnings: SchemaIssue[];
}

/**
 * Memeriksa bentuk schema sekaligus konsistensinya.
 * Kalau bentuknya sudah tidak valid, pemeriksaan konsistensi dilewati karena
 * datanya tidak bisa dipercaya.
 */
export function validateFormSchema(input: unknown): SchemaValidationResult {
  const parsed = formSchemaSchema.safeParse(input);

  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
        code: 'invalid_shape',
      })),
      warnings: [],
    };
  }

  return validateParsedFormSchema(parsed.data);
}

/** Varian untuk schema yang sudah lolos `formSchemaSchema.parse()`. */
export function validateParsedFormSchema(schema: FormSchema): SchemaValidationResult {
  const errors: SchemaIssue[] = [];
  const warnings: SchemaIssue[] = [];

  const fieldById = new Map<string, FormField>();
  const fieldIndexById = new Map<string, number>();

  checkFieldIdsAndNames(schema, fieldById, fieldIndexById, errors);
  checkOptions(schema, errors);
  checkValidationRanges(schema, errors);
  checkConditions(schema, fieldById, fieldIndexById, errors, warnings);
  checkCycles(schema, errors);
  checkPublishable(schema, warnings);

  return { valid: errors.length === 0, errors, warnings };
}

/** Lempar error kalau schema tidak layak publish. Dipakai FormsService. */
export class FormSchemaInvalidError extends Error {
  constructor(public readonly result: SchemaValidationResult) {
    super(`Schema form tidak valid: ${result.errors.map((e) => e.message).join('; ')}`);
    this.name = 'FormSchemaInvalidError';
  }
}

export function assertFormSchemaValid(schema: FormSchema): void {
  const result = validateParsedFormSchema(schema);

  if (!result.valid) throw new FormSchemaInvalidError(result);
}

// ---------------------------------------------------------------------------
// Pemeriksaan per aspek
// ---------------------------------------------------------------------------

function checkFieldIdsAndNames(
  schema: FormSchema,
  fieldById: Map<string, FormField>,
  fieldIndexById: Map<string, number>,
  errors: SchemaIssue[],
): void {
  const seenNames = new Map<string, number>();

  schema.fields.forEach((field, index) => {
    if (fieldById.has(field.id)) {
      errors.push({
        path: `fields[${index}].id`,
        message: `Id field "${field.id}" dipakai lebih dari sekali`,
        code: 'duplicate_field_id',
      });
    } else {
      fieldById.set(field.id, field);
      fieldIndexById.set(field.id, index);
    }

    // Nama dipakai sebagai header kolom saat ekspor & sync spreadsheet,
    // jadi dobel nama berarti ada kolom yang saling menimpa.
    const normalizedName = field.name.toLowerCase();
    const previousIndex = seenNames.get(normalizedName);

    if (previousIndex !== undefined) {
      errors.push({
        path: `fields[${index}].name`,
        message: `Nama field "${field.name}" sudah dipakai field ke-${previousIndex + 1}`,
        code: 'duplicate_field_name',
      });
    } else {
      seenNames.set(normalizedName, index);
    }
  });
}

function checkOptions(schema: FormSchema, errors: SchemaIssue[]): void {
  schema.fields.forEach((field, index) => {
    if (!hasOptions(field)) return;

    const seenIds = new Set<string>();
    const seenValues = new Set<string>();

    field.options.forEach((option, optionIndex) => {
      if (seenIds.has(option.id)) {
        errors.push({
          path: `fields[${index}].options[${optionIndex}].id`,
          message: `Id opsi "${option.id}" dipakai lebih dari sekali di field "${field.name}"`,
          code: 'duplicate_option_id',
        });
      }
      seenIds.add(option.id);

      const value = optionValue(option);

      if (seenValues.has(value)) {
        errors.push({
          path: `fields[${index}].options[${optionIndex}].value`,
          message: `Nilai opsi "${value}" dipakai lebih dari sekali di field "${field.name}"`,
          code: 'duplicate_option_value',
        });
      }
      seenValues.add(value);
    });
  });
}

function checkValidationRanges(schema: FormSchema, errors: SchemaIssue[]): void {
  schema.fields.forEach((field, index) => {
    if (!('validation' in field)) return;

    const validation = field.validation as Record<string, unknown>;
    const path = `fields[${index}].validation`;

    assertRange(
      validation.minLength,
      validation.maxLength,
      `${path}.minLength`,
      'minLength tidak boleh lebih besar dari maxLength',
      errors,
    );
    assertRange(
      validation.min,
      validation.max,
      `${path}.min`,
      'min tidak boleh lebih besar dari max',
      errors,
    );
    assertRange(
      validation.minSelected,
      validation.maxSelected,
      `${path}.minSelected`,
      'minSelected tidak boleh lebih besar dari maxSelected',
      errors,
    );

    if (typeof validation.pattern === 'string') {
      try {
        new RegExp(validation.pattern);
      } catch {
        errors.push({
          path: `${path}.pattern`,
          message: `Pola regex tidak valid: ${validation.pattern}`,
          code: 'invalid_pattern',
        });
      }
    }

    // minSelected lebih besar dari jumlah opsi berarti field itu mustahil diisi.
    if (
      hasOptions(field) &&
      typeof validation.minSelected === 'number' &&
      validation.minSelected > field.options.length
    ) {
      errors.push({
        path: `${path}.minSelected`,
        message: `minSelected (${validation.minSelected}) melebihi jumlah opsi (${field.options.length})`,
        code: 'min_selected_exceeds_options',
      });
    }
  });
}

function assertRange(
  minValue: unknown,
  maxValue: unknown,
  path: string,
  message: string,
  errors: SchemaIssue[],
): void {
  if (typeof minValue === 'number' && typeof maxValue === 'number' && minValue > maxValue) {
    errors.push({ path, message, code: 'invalid_range' });
  }
}

function checkConditions(
  schema: FormSchema,
  fieldById: Map<string, FormField>,
  fieldIndexById: Map<string, number>,
  errors: SchemaIssue[],
  warnings: SchemaIssue[],
): void {
  schema.fields.forEach((field, index) => {
    checkGroup(
      field.conditions?.visibility,
      `fields[${index}].conditions.visibility`,
      field.id,
      index,
    );

    if (hasOptions(field)) {
      field.options.forEach((option, optionIndex) => {
        checkGroup(
          option.conditions?.visibility,
          `fields[${index}].options[${optionIndex}].conditions.visibility`,
          field.id,
          index,
        );
      });
    }
  });

  function checkGroup(
    group: ConditionGroup | undefined,
    basePath: string,
    ownerFieldId: string,
    ownerIndex: number,
  ): void {
    if (!group) return;

    group.rules.forEach((rule, ruleIndex) => {
      const path = `${basePath}.rules[${ruleIndex}]`;
      const target = fieldById.get(rule.fieldId);

      if (!target) {
        errors.push({
          path: `${path}.fieldId`,
          message: `Kondisi menunjuk field "${rule.fieldId}" yang tidak ada di schema`,
          code: 'unknown_condition_field',
        });
        return;
      }

      if (rule.fieldId === ownerFieldId) {
        errors.push({
          path: `${path}.fieldId`,
          message: 'Kondisi tidak boleh menunjuk ke field-nya sendiri',
          code: 'self_referencing_condition',
        });
        return;
      }

      if (!isInputFormField(target)) {
        errors.push({
          path: `${path}.fieldId`,
          message: `Kondisi menunjuk field "${target.name}" yang tidak menghasilkan jawaban (${target.type})`,
          code: 'condition_on_non_input_field',
        });
        return;
      }

      checkRuleValue(rule.operator, rule.value, path, errors);

      // Untuk field beropsi, nilai rule harus menunjuk opsi yang benar-benar ada,
      // supaya rule tidak diam-diam jadi tidak pernah terpenuhi saat opsi dihapus.
      if (hasOptions(target) && rule.value !== undefined && rule.value !== null) {
        const known = new Set(target.options.flatMap((o) => [o.id, optionValue(o)]));
        const candidates = Array.isArray(rule.value) ? rule.value : [rule.value];
        const unknown = candidates.filter((c) => !known.has(String(c)));

        if (unknown.length > 0) {
          errors.push({
            path: `${path}.value`,
            message: `Opsi ${unknown.map((u) => `"${String(u)}"`).join(', ')} tidak ada di field "${target.name}"`,
            code: 'unknown_condition_option',
          });
        }
      }

      // Merujuk field yang tampil setelahnya bukan hal terlarang (form satu halaman
      // bisa diisi tidak berurutan), tapi hampir selalu tidak disengaja.
      const targetIndex = fieldIndexById.get(rule.fieldId);

      if (targetIndex !== undefined && targetIndex > ownerIndex) {
        warnings.push({
          path: `${path}.fieldId`,
          message: `Kondisi menunjuk field "${target.name}" yang letaknya di bawah field ini`,
          code: 'forward_reference',
        });
      }
    });
  }
}

function checkRuleValue(
  operator: string,
  value: unknown,
  path: string,
  errors: SchemaIssue[],
): void {
  const needsNoValue = (VALUELESS_OPERATORS as readonly string[]).includes(operator);
  const needsArray = (ARRAY_VALUE_OPERATORS as readonly string[]).includes(operator);

  if (needsNoValue) return;

  if (value === undefined) {
    errors.push({
      path: `${path}.value`,
      message: `Operator "${operator}" membutuhkan nilai pembanding`,
      code: 'missing_condition_value',
    });
    return;
  }

  if (needsArray && !Array.isArray(value)) {
    errors.push({
      path: `${path}.value`,
      message: `Operator "${operator}" membutuhkan nilai berupa array`,
      code: 'condition_value_not_array',
    });
  }
}

/**
 * Mendeteksi siklus pada rantai kondisi, misal A tampil kalau B terisi sementara
 * B tampil kalau A terisi — keduanya tidak akan pernah punya hasil yang stabil.
 */
function checkCycles(schema: FormSchema, errors: SchemaIssue[]): void {
  const graph = new Map<string, string[]>();

  for (const field of schema.fields) {
    graph.set(field.id, dependenciesOf(field));
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const reported = new Set<string>();

  const visit = (fieldId: string, trail: string[]): void => {
    const current = state.get(fieldId);

    if (current === 'done') return;

    if (current === 'visiting') {
      const cycle = [...trail.slice(trail.indexOf(fieldId)), fieldId];
      const key = [...cycle].sort().join('>');

      if (!reported.has(key)) {
        reported.add(key);
        errors.push({
          path: `fields.${fieldId}.conditions`,
          message: `Kondisi saling melingkar: ${cycle.join(' → ')}`,
          code: 'cyclic_condition',
        });
      }
      return;
    }

    state.set(fieldId, 'visiting');

    for (const dependency of graph.get(fieldId) ?? []) {
      if (graph.has(dependency)) visit(dependency, [...trail, fieldId]);
    }

    state.set(fieldId, 'done');
  };

  for (const fieldId of graph.keys()) {
    visit(fieldId, []);
  }
}

function checkPublishable(schema: FormSchema, warnings: SchemaIssue[]): void {
  const inputFields = schema.fields.filter(isInputFormField);

  if (inputFields.length === 0) {
    warnings.push({
      path: 'fields',
      message: 'Form belum punya satu pun field isian',
      code: 'no_input_fields',
    });
  }
}

/** Cek layak-publish: form harus punya minimal satu field isian. */
export function validateForPublish(schema: FormSchema): SchemaValidationResult {
  const result = validateParsedFormSchema(schema);
  const inputFields = schema.fields.filter(isInputFormField);

  if (inputFields.length === 0) {
    return {
      valid: false,
      errors: [
        ...result.errors,
        {
          path: 'fields',
          message: 'Form harus punya minimal satu field isian sebelum dipublish',
          code: 'no_input_fields',
        },
      ],
      warnings: result.warnings.filter((w) => w.code !== 'no_input_fields'),
    };
  }

  return result;
}
