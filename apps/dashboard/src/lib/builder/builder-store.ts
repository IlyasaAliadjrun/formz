'use client';

import {
  validateParsedFormSchema,
  type FieldType,
  type FormField,
  type FormSchema,
  type FormSettings,
  type SchemaValidationResult,
} from '@formz/shared';
import { create } from 'zustand';
import { createDefaultField, duplicateField as cloneField } from './field-defaults';

/**
 * State builder form.
 *
 * Schema disimpan di satu tempat supaya ketiga panel (daftar field, preview,
 * property editor) selalu melihat data yang sama — preview real-time hanyalah
 * render ulang dari state ini, bukan salinan yang perlu disinkronkan.
 */

interface BuilderState {
  schema: FormSchema | null;
  selectedFieldId: string | null;
  /** True kalau ada perubahan yang belum disimpan ke server. */
  isDirty: boolean;

  /** Memuat schema dari server; mengembalikan penanda dirty ke kondisi bersih. */
  loadSchema: (schema: FormSchema) => void;
  markSaved: () => void;

  selectField: (fieldId: string | null) => void;
  addField: (type: FieldType) => void;
  updateField: (fieldId: string, patch: Partial<FormField> | Record<string, unknown>) => void;
  replaceField: (fieldId: string, field: FormField) => void;
  removeField: (fieldId: string) => void;
  duplicateField: (fieldId: string) => void;
  moveField: (fromIndex: number, toIndex: number) => void;

  setTitle: (title: string) => void;
  setDescription: (description: string) => void;
  updateSettings: (patch: Partial<FormSettings>) => void;

  getValidation: () => SchemaValidationResult | null;
  getSelectedField: () => FormField | null;
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  schema: null,
  selectedFieldId: null,
  isDirty: false,

  loadSchema: (schema) =>
    set((state) => ({
      schema,
      isDirty: false,
      // Pertahankan pilihan kalau field-nya masih ada setelah reload.
      selectedFieldId: schema.fields.some((field) => field.id === state.selectedFieldId)
        ? state.selectedFieldId
        : (schema.fields[0]?.id ?? null),
    })),

  markSaved: () => set({ isDirty: false }),

  selectField: (fieldId) => set({ selectedFieldId: fieldId }),

  addField: (type) =>
    set((state) => {
      if (!state.schema) return state;

      const field = createDefaultField(type, state.schema);
      const selectedIndex = state.schema.fields.findIndex(
        (item) => item.id === state.selectedFieldId,
      );

      // Field baru disisipkan tepat di bawah field yang sedang dipilih —
      // lebih sesuai dengan cara orang menyusun form dari atas ke bawah.
      const insertAt = selectedIndex === -1 ? state.schema.fields.length : selectedIndex + 1;
      const fields = [...state.schema.fields];
      fields.splice(insertAt, 0, field);

      return {
        schema: { ...state.schema, fields },
        selectedFieldId: field.id,
        isDirty: true,
      };
    }),

  updateField: (fieldId, patch) =>
    set((state) => {
      if (!state.schema) return state;

      const fields = state.schema.fields.map((field) =>
        field.id === fieldId ? ({ ...field, ...patch } as FormField) : field,
      );

      return { schema: { ...state.schema, fields }, isDirty: true };
    }),

  replaceField: (fieldId, next) =>
    set((state) => {
      if (!state.schema) return state;

      const fields = state.schema.fields.map((field) => (field.id === fieldId ? next : field));

      return { schema: { ...state.schema, fields }, isDirty: true };
    }),

  removeField: (fieldId) =>
    set((state) => {
      if (!state.schema) return state;

      const index = state.schema.fields.findIndex((field) => field.id === fieldId);
      const fields = state.schema.fields.filter((field) => field.id !== fieldId);

      // Kondisi milik field lain yang menunjuk field terhapus ikut dibersihkan,
      // supaya schema tidak langsung jadi tidak valid setelah menghapus.
      const cleaned = fields.map((field) => stripReferencesTo(field, fieldId));

      const nextSelected =
        state.selectedFieldId === fieldId
          ? (cleaned[Math.min(index, cleaned.length - 1)]?.id ?? null)
          : state.selectedFieldId;

      return {
        schema: { ...state.schema, fields: cleaned },
        selectedFieldId: nextSelected,
        isDirty: true,
      };
    }),

  duplicateField: (fieldId) =>
    set((state) => {
      if (!state.schema) return state;

      const index = state.schema.fields.findIndex((field) => field.id === fieldId);
      const source = state.schema.fields[index];
      if (!source) return state;

      const copy = cloneField(source, state.schema);
      const fields = [...state.schema.fields];
      fields.splice(index + 1, 0, copy);

      return { schema: { ...state.schema, fields }, selectedFieldId: copy.id, isDirty: true };
    }),

  moveField: (fromIndex, toIndex) =>
    set((state) => {
      if (!state.schema) return state;
      if (fromIndex === toIndex) return state;

      const fields = [...state.schema.fields];
      const [moved] = fields.splice(fromIndex, 1);
      if (!moved) return state;

      fields.splice(toIndex, 0, moved);

      return { schema: { ...state.schema, fields }, isDirty: true };
    }),

  setTitle: (title) =>
    set((state) => (state.schema ? { schema: { ...state.schema, title }, isDirty: true } : state)),

  setDescription: (description) =>
    set((state) =>
      state.schema
        ? { schema: { ...state.schema, description: description || undefined }, isDirty: true }
        : state,
    ),

  updateSettings: (patch) =>
    set((state) =>
      state.schema
        ? {
            schema: { ...state.schema, settings: { ...state.schema.settings, ...patch } },
            isDirty: true,
          }
        : state,
    ),

  getValidation: () => {
    const { schema } = get();
    return schema ? validateParsedFormSchema(schema) : null;
  },

  getSelectedField: () => {
    const { schema, selectedFieldId } = get();
    return schema?.fields.find((field) => field.id === selectedFieldId) ?? null;
  },
}));

/** Membuang rule kondisi yang menunjuk field yang baru dihapus. */
function stripReferencesTo(field: FormField, removedFieldId: string): FormField {
  const cleanGroup = (conditions: FormField['conditions']) => {
    const group = conditions?.visibility;
    if (!group) return conditions;

    const rules = group.rules.filter((rule) => rule.fieldId !== removedFieldId);

    // Grup tanpa rule tersisa berarti kondisinya ikut hilang.
    if (rules.length === 0) return undefined;
    if (rules.length === group.rules.length) return conditions;

    return { ...conditions, visibility: { ...group, rules } };
  };

  const next: Record<string, unknown> = { ...field, conditions: cleanGroup(field.conditions) };

  if ('options' in field && Array.isArray(field.options)) {
    next.options = field.options.map((option) => ({
      ...option,
      conditions: cleanGroup(option.conditions),
    }));
  }

  return next as FormField;
}
