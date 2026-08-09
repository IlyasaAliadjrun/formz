'use client';

import {
  ARRAY_VALUE_OPERATORS,
  CONDITION_OPERATORS,
  VALUELESS_OPERATORS,
  hasOptions,
  isInputFormField,
  optionValue,
  type ConditionOperator,
  type ConditionRule,
  type Conditions,
  type FormField,
} from '@formz/shared';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: 'sama dengan',
  not_equals: 'tidak sama dengan',
  contains: 'mengandung',
  not_contains: 'tidak mengandung',
  starts_with: 'diawali',
  ends_with: 'diakhiri',
  greater_than: 'lebih dari',
  greater_than_or_equal: 'lebih dari atau sama dengan',
  less_than: 'kurang dari',
  less_than_or_equal: 'kurang dari atau sama dengan',
  is_empty: 'kosong',
  is_not_empty: 'terisi',
  in: 'salah satu dari',
  not_in: 'bukan salah satu dari',
};

const VALUELESS = new Set<string>(VALUELESS_OPERATORS);
const ARRAY_VALUED = new Set<string>(ARRAY_VALUE_OPERATORS);

interface ConditionBuilderProps {
  /** Kondisi yang sedang disunting (milik field atau milik satu opsi). */
  conditions: Conditions | undefined;
  onChange: (conditions: Conditions | undefined) => void;
  /** Field yang boleh dijadikan acuan — sudah tidak termasuk pemiliknya sendiri. */
  availableFields: FormField[];
  /** Teks pengantar, berbeda untuk kondisi field dan kondisi opsi. */
  subjectLabel: string;
  /**
   * Label untuk kedua aksi. Bawaannya bahasa visibilitas
   * ("Tampilkan"/"Sembunyikan"), tapi komponen ini juga dipakai untuk kondisi
   * yang tidak ada hubungannya dengan tampil-tidaknya sesuatu — misalnya kapan
   * sebuah notifikasi dikirim — dan di sana kata "Tampilkan" hanya membingungkan.
   */
  actionLabels?: { show: string; hide: string };
  /** Kalimat saat belum ada kondisi sama sekali. */
  emptyLabel?: string;
  disabled?: boolean;
}

export function ConditionBuilder({
  conditions,
  onChange,
  availableFields,
  subjectLabel,
  actionLabels = { show: 'Tampilkan', hide: 'Sembunyikan' },
  emptyLabel,
  disabled,
}: ConditionBuilderProps) {
  const group = conditions?.visibility;

  // Hanya field isian yang bisa jadi acuan — section_heading tidak punya jawaban.
  const referenceable = availableFields.filter(isInputFormField);

  const enable = () => {
    const first = referenceable[0];
    if (!first) return;

    onChange({
      visibility: {
        action: 'show',
        logic: 'AND',
        rules: [{ fieldId: first.id, operator: 'equals', value: defaultValueFor(first) }],
      },
    });
  };

  if (referenceable.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-xs">
        Butuh minimal satu field isian lain sebagai acuan kondisi.
      </p>
    );
  }

  if (!group) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">
          {emptyLabel ?? `${subjectLabel} selalu tampil.`}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={enable} disabled={disabled}>
          <Plus />
          Tambah kondisi
        </Button>
      </div>
    );
  }

  const updateGroup = (patch: Partial<typeof group>) =>
    onChange({ visibility: { ...group, ...patch } });

  const updateRule = (index: number, patch: Partial<ConditionRule>) => {
    const rules = group.rules.map((rule, position) =>
      position === index ? { ...rule, ...patch } : rule,
    );
    updateGroup({ rules });
  };

  const removeRule = (index: number) => {
    const rules = group.rules.filter((_, position) => position !== index);

    // Grup tanpa rule tidak punya arti — kondisinya dihapus seluruhnya.
    if (rules.length === 0) onChange(undefined);
    else updateGroup({ rules });
  };

  const addRule = () => {
    const first = referenceable[0];
    if (!first) return;

    updateGroup({
      rules: [
        ...group.rules,
        { fieldId: first.id, operator: 'equals', value: defaultValueFor(first) },
      ],
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <NativeSelect
          value={group.action}
          onChange={(event) => updateGroup({ action: event.target.value as 'show' | 'hide' })}
          // Lebarnya mengikuti isi: label aksinya bisa diganti pemanggil
          // ("Tambahkan", "Jangan kirim"), jadi lebar tetap akan memotong teks.
          className="h-8 w-auto min-w-28"
          disabled={disabled}
          aria-label="Aksi kondisi"
        >
          <option value="show">{actionLabels.show}</option>
          <option value="hide">{actionLabels.hide}</option>
        </NativeSelect>

        <span className="text-muted-foreground">{subjectLabel.toLowerCase()} jika</span>

        <NativeSelect
          value={group.logic}
          onChange={(event) => updateGroup({ logic: event.target.value as 'AND' | 'OR' })}
          className="h-8 w-32"
          disabled={disabled}
          aria-label="Penggabung rule"
        >
          <option value="AND">semua rule</option>
          <option value="OR">salah satu rule</option>
        </NativeSelect>

        <span className="text-muted-foreground">terpenuhi:</span>
      </div>

      <div className="flex flex-col gap-2">
        {group.rules.map((rule, index) => (
          <RuleRow
            key={index}
            rule={rule}
            fields={referenceable}
            disabled={disabled}
            onChange={(patch) => updateRule(index, patch)}
            onRemove={() => removeRule(index)}
          />
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addRule} disabled={disabled}>
        <Plus />
        Tambah rule
      </Button>
    </div>
  );
}

function RuleRow({
  rule,
  fields,
  disabled,
  onChange,
  onRemove,
}: {
  rule: ConditionRule;
  fields: FormField[];
  disabled?: boolean;
  onChange: (patch: Partial<ConditionRule>) => void;
  onRemove: () => void;
}) {
  const target = fields.find((field) => field.id === rule.fieldId);
  const needsValue = !VALUELESS.has(rule.operator);
  const wantsArray = ARRAY_VALUED.has(rule.operator);

  return (
    <div className="bg-muted/30 flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <NativeSelect
          value={rule.fieldId}
          onChange={(event) => {
            const next = fields.find((field) => field.id === event.target.value);
            // Ganti acuan berarti nilai lama bisa jadi tidak relevan lagi.
            onChange({
              fieldId: event.target.value,
              value: next ? defaultValueFor(next) : undefined,
            });
          }}
          className="h-8 flex-1"
          disabled={disabled}
          aria-label="Field acuan"
        >
          {fields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.label}
            </option>
          ))}
        </NativeSelect>

        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-muted-foreground hover:text-destructive shrink-0 rounded p-1.5"
          aria-label="Hapus rule"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <NativeSelect
          value={rule.operator}
          onChange={(event) => {
            const operator = event.target.value as ConditionOperator;
            const nextWantsArray = ARRAY_VALUED.has(operator);
            const nextNeedsValue = !VALUELESS.has(operator);

            onChange({
              operator,
              value: !nextNeedsValue
                ? undefined
                : nextWantsArray
                  ? toArray(rule.value)
                  : fromArray(rule.value),
            });
          }}
          className="h-8 flex-1"
          disabled={disabled}
          aria-label="Operator"
        >
          {CONDITION_OPERATORS.map((operator) => (
            <option key={operator} value={operator}>
              {OPERATOR_LABELS[operator]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {needsValue && target && (
        <ValueInput
          field={target}
          value={rule.value}
          multiple={wantsArray}
          disabled={disabled}
          onChange={(value) => onChange({ value })}
        />
      )}
    </div>
  );
}

/**
 * Input nilai pembanding.
 *
 * Kalau field acuannya punya opsi, yang ditampilkan adalah daftar opsinya — bukan
 * kotak teks bebas. Inilah yang membuat kondisi bisa menunjuk pilihan spesifik
 * (misal "Jenis Layanan = Implementasi") tanpa pengguna perlu tahu id opsinya.
 */
function ValueInput({
  field,
  value,
  multiple,
  disabled,
  onChange,
}: {
  field: FormField;
  value: ConditionRule['value'];
  multiple: boolean;
  disabled?: boolean;
  onChange: (value: ConditionRule['value']) => void;
}) {
  if (hasOptions(field)) {
    if (multiple) {
      const selected = Array.isArray(value) ? value.map(String) : [];

      return (
        <div className="flex flex-col gap-1.5 rounded-md border px-2.5 py-2">
          <Label className="text-muted-foreground text-[11px]">Pilih opsi</Label>
          {field.options.map((option) => {
            const itemValue = optionValue(option);

            return (
              <label key={option.id} className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={selected.includes(itemValue)}
                  disabled={disabled}
                  onCheckedChange={(next) =>
                    onChange(
                      next
                        ? [...selected, itemValue]
                        : selected.filter((item) => item !== itemValue),
                    )
                  }
                />
                {option.label}
              </label>
            );
          })}
        </div>
      );
    }

    return (
      <NativeSelect
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        className="h-8"
        disabled={disabled}
        aria-label="Nilai pembanding"
      >
        <option value="">— Pilih opsi —</option>
        {field.options.map((option) => (
          <option key={option.id} value={optionValue(option)}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <NativeSelect
        value={value === true ? 'true' : 'false'}
        onChange={(event) => onChange(event.target.value === 'true')}
        className="h-8"
        disabled={disabled}
        aria-label="Nilai pembanding"
      >
        <option value="true">dicentang</option>
        <option value="false">tidak dicentang</option>
      </NativeSelect>
    );
  }

  if (multiple) {
    const items = Array.isArray(value) ? value.map(String) : [];

    return (
      <Input
        className="h-8"
        placeholder="Pisahkan dengan koma"
        value={items.join(', ')}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
        aria-label="Nilai pembanding"
      />
    );
  }

  const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';

  return (
    <Input
      className="h-8"
      type={inputType}
      placeholder="Nilai pembanding"
      value={value === null || value === undefined ? '' : String(value)}
      disabled={disabled}
      onChange={(event) =>
        onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)
      }
      aria-label="Nilai pembanding"
    />
  );
}

/** Nilai awal yang masuk akal saat field acuan baru dipilih. */
function defaultValueFor(field: FormField): ConditionRule['value'] {
  if (hasOptions(field)) return field.options[0] ? optionValue(field.options[0]) : '';
  if (field.type === 'checkbox') return true;
  if (field.type === 'number') return 0;

  return '';
}

function toArray(value: ConditionRule['value']): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === '') return [];

  return [String(value)];
}

function fromArray(value: ConditionRule['value']): string {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : '';

  return value === undefined || value === null ? '' : String(value);
}
