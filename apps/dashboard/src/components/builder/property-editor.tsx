'use client';

import {
  FIELD_TYPE_DEFINITIONS,
  hasOptions,
  supportsValidationAttribute,
  type FieldType,
  type FormField,
  type SchemaIssue,
  type ValidationAttribute,
} from '@formz/shared';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ConditionBuilder } from './condition-builder';
import { OptionEditor } from './option-editor';

interface PropertyEditorProps {
  field: FormField;
  /** Field lain di form yang sama, dipakai sebagai acuan kondisi. */
  otherFields: FormField[];
  issues: SchemaIssue[];
  disabled?: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}

export function PropertyEditor({
  field,
  otherFields,
  issues,
  disabled,
  onChange,
}: PropertyEditorProps) {
  const definition = FIELD_TYPE_DEFINITIONS[field.type as FieldType];
  const validation = 'validation' in field ? (field.validation as Record<string, unknown>) : null;

  const supports = (attribute: ValidationAttribute) =>
    supportsValidationAttribute(field.type as FieldType, attribute);

  const updateValidation = (patch: Record<string, unknown>) =>
    onChange({ validation: { ...validation, ...patch } });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-muted-foreground text-xs">{definition.label}</p>
        <p className="text-muted-foreground text-[11px]">{definition.description}</p>
      </div>

      {issues.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {issues.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* ---------- Dasar ---------- */}
      <section className="flex flex-col gap-3">
        <Field label="Label" htmlFor="prop-label">
          <Input
            id="prop-label"
            value={field.label}
            onChange={(event) => onChange({ label: event.target.value })}
            disabled={disabled}
          />
        </Field>

        <Field
          label="Nama field"
          htmlFor="prop-name"
          hint="Dipakai sebagai nama kolom saat ekspor & sync spreadsheet. Huruf, angka, dan garis bawah."
        >
          <Input
            id="prop-name"
            value={field.name}
            onChange={(event) => onChange({ name: event.target.value })}
            className="font-mono text-xs"
            disabled={disabled}
          />
        </Field>

        <Field label="Deskripsi" htmlFor="prop-description">
          <Textarea
            id="prop-description"
            rows={2}
            value={field.description ?? ''}
            onChange={(event) => onChange({ description: event.target.value || undefined })}
            disabled={disabled}
          />
        </Field>

        {field.type !== 'section_heading' && (
          <Field label="Teks bantuan" htmlFor="prop-help">
            <Input
              id="prop-help"
              value={field.helpText ?? ''}
              onChange={(event) => onChange({ helpText: event.target.value || undefined })}
              disabled={disabled}
            />
          </Field>
        )}

        {'placeholder' in field && (
          <Field label="Placeholder" htmlFor="prop-placeholder">
            <Input
              id="prop-placeholder"
              value={field.placeholder ?? ''}
              onChange={(event) => onChange({ placeholder: event.target.value || undefined })}
              disabled={disabled}
            />
          </Field>
        )}

        {field.type === 'section_heading' && (
          <Field label="Tingkat judul" htmlFor="prop-level">
            <NativeSelect
              id="prop-level"
              value={String(field.level)}
              onChange={(event) => onChange({ level: Number(event.target.value) })}
              disabled={disabled}
            >
              <option value="2">Judul utama</option>
              <option value="3">Sub judul</option>
            </NativeSelect>
          </Field>
        )}

        {field.type === 'textarea' && (
          <Field label="Jumlah baris" htmlFor="prop-rows">
            <Input
              id="prop-rows"
              type="number"
              min={2}
              max={30}
              value={field.rows ?? 4}
              onChange={(event) => onChange({ rows: Number(event.target.value) || undefined })}
              disabled={disabled}
            />
          </Field>
        )}
      </section>

      {/* ---------- Opsi ---------- */}
      {hasOptions(field) && (
        <>
          <Separator />
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Opsi</h3>
            <p className="text-muted-foreground text-[11px]">
              Klik panah di kiri opsi untuk mengatur nilai tersimpan dan kondisi tampil per opsi.
            </p>
            <OptionEditor
              options={field.options}
              availableFields={otherFields}
              disabled={disabled}
              onChange={(options) => onChange({ options })}
            />
          </section>
        </>
      )}

      {/* ---------- Validasi ---------- */}
      {validation && (
        <>
          <Separator />
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">Validasi</h3>

            {supports('required') && (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Wajib diisi
                  {field.type === 'checkbox' && (
                    <span className="text-muted-foreground block text-[11px]">
                      Kotak ini harus dicentang untuk bisa submit
                    </span>
                  )}
                </span>
                <Switch
                  checked={Boolean(validation.required)}
                  onCheckedChange={(checked) => updateValidation({ required: checked })}
                  disabled={disabled}
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              {supports('minLength') && (
                <NumberField
                  label="Panjang min"
                  value={validation.minLength}
                  disabled={disabled}
                  onChange={(value) => updateValidation({ minLength: value })}
                />
              )}
              {supports('maxLength') && (
                <NumberField
                  label="Panjang maks"
                  value={validation.maxLength}
                  disabled={disabled}
                  onChange={(value) => updateValidation({ maxLength: value })}
                />
              )}
              {supports('min') && (
                <NumberField
                  label="Nilai min"
                  value={validation.min}
                  disabled={disabled}
                  onChange={(value) => updateValidation({ min: value })}
                />
              )}
              {supports('max') && (
                <NumberField
                  label="Nilai maks"
                  value={validation.max}
                  disabled={disabled}
                  onChange={(value) => updateValidation({ max: value })}
                />
              )}
              {supports('minSelected') && (
                <NumberField
                  label="Min dipilih"
                  value={validation.minSelected}
                  disabled={disabled}
                  onChange={(value) => updateValidation({ minSelected: value })}
                />
              )}
              {supports('maxSelected') && (
                <NumberField
                  label="Maks dipilih"
                  value={validation.maxSelected}
                  disabled={disabled}
                  onChange={(value) => updateValidation({ maxSelected: value })}
                />
              )}
              {supports('maxFiles') && (
                <NumberField
                  label="Maks berkas"
                  value={validation.maxFiles}
                  disabled={disabled}
                  onChange={(value) => updateValidation({ maxFiles: value ?? 1 })}
                />
              )}
            </div>

            {supports('integerOnly') && (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Hanya bilangan bulat</span>
                <Switch
                  checked={Boolean(validation.integerOnly)}
                  onCheckedChange={(checked) => updateValidation({ integerOnly: checked })}
                  disabled={disabled}
                />
              </label>
            )}

            {supports('minDate') && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tanggal min" htmlFor="prop-min-date">
                  <Input
                    id="prop-min-date"
                    type={field.type === 'datetime' ? 'datetime-local' : 'date'}
                    value={(validation.minDate as string) ?? ''}
                    onChange={(event) =>
                      updateValidation({ minDate: event.target.value || undefined })
                    }
                    disabled={disabled}
                  />
                </Field>
                <Field label="Tanggal maks" htmlFor="prop-max-date">
                  <Input
                    id="prop-max-date"
                    type={field.type === 'datetime' ? 'datetime-local' : 'date'}
                    value={(validation.maxDate as string) ?? ''}
                    onChange={(event) =>
                      updateValidation({ maxDate: event.target.value || undefined })
                    }
                    disabled={disabled}
                  />
                </Field>
              </div>
            )}

            {supports('pattern') && (
              <Field
                label="Pola (regex)"
                htmlFor="prop-pattern"
                hint="Contoh: ^08[0-9]{8,11}$ untuk nomor HP Indonesia"
              >
                <Input
                  id="prop-pattern"
                  value={(validation.pattern as string) ?? ''}
                  onChange={(event) =>
                    updateValidation({ pattern: event.target.value || undefined })
                  }
                  className="font-mono text-xs"
                  disabled={disabled}
                />
              </Field>
            )}

            {supports('maxFileSizeBytes') && (
              <Field label="Ukuran maks per berkas (MB)" htmlFor="prop-max-size">
                <Input
                  id="prop-max-size"
                  type="number"
                  min={1}
                  value={
                    validation.maxFileSizeBytes
                      ? Math.round((validation.maxFileSizeBytes as number) / 1024 / 1024)
                      : ''
                  }
                  onChange={(event) =>
                    updateValidation({
                      maxFileSizeBytes: event.target.value
                        ? Number(event.target.value) * 1024 * 1024
                        : undefined,
                    })
                  }
                  disabled={disabled}
                />
              </Field>
            )}

            {supports('allowedMimeTypes') && (
              <Field
                label="Tipe berkas yang diizinkan"
                htmlFor="prop-mime"
                hint="Pisahkan dengan koma, misal: image/png, application/pdf"
              >
                <Input
                  id="prop-mime"
                  value={((validation.allowedMimeTypes as string[]) ?? []).join(', ')}
                  onChange={(event) =>
                    updateValidation({
                      allowedMimeTypes: event.target.value
                        ? event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean)
                        : undefined,
                    })
                  }
                  className="text-xs"
                  disabled={disabled}
                />
              </Field>
            )}

            <Field
              label="Pesan error kustom"
              htmlFor="prop-error"
              hint="Kosongkan untuk memakai pesan bawaan"
            >
              <Input
                id="prop-error"
                value={(validation.errorMessage as string) ?? ''}
                onChange={(event) =>
                  updateValidation({ errorMessage: event.target.value || undefined })
                }
                disabled={disabled}
              />
            </Field>
          </section>
        </>
      )}

      {/* ---------- Kondisi tampil ---------- */}
      <Separator />
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Kondisi tampil</h3>
        <ConditionBuilder
          conditions={field.conditions}
          onChange={(conditions) => onChange({ conditions })}
          availableFields={otherFields}
          subjectLabel="Field ini"
          disabled={disabled}
        />
      </section>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </div>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: unknown;
  disabled?: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : Number(event.target.value))
        }
        disabled={disabled}
      />
    </div>
  );
}
