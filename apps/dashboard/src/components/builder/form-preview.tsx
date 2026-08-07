'use client';

import { useMemo, useState } from 'react';
import {
  evaluateConditions,
  hasOptions,
  optionValue,
  type AnswerMap,
  type FormField,
  type FormSchema,
} from '@formz/shared';
import { EyeOff, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Preview form yang bisa diisi.
 *
 * Visibilitas dihitung dengan `evaluateConditions` dari @formz/shared — fungsi
 * yang sama persis yang dipakai form renderer dan dipakai server saat memvalidasi
 * ulang submit. Jadi apa yang terlihat di sini adalah perilaku sebenarnya, bukan
 * tiruan yang bisa menyimpang.
 */
export function FormPreview({
  schema,
  selectedFieldId,
  onSelectField,
}: {
  schema: FormSchema;
  selectedFieldId: string | null;
  onSelectField?: (fieldId: string) => void;
}) {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [showHidden, setShowHidden] = useState(false);

  const evaluation = useMemo(() => evaluateConditions(schema, answers), [schema, answers]);

  const setAnswer = (fieldId: string, value: AnswerMap[string]) =>
    setAnswers((current) => ({ ...current, [fieldId]: value }));

  const hiddenCount = evaluation.hiddenFieldIds.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          Preview interaktif — isi field untuk menguji aturan tampil/sembunyi.
        </p>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((current) => !current)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
            >
              <EyeOff className="size-3.5" />
              {showHidden ? 'Sembunyikan' : `Tampilkan ${hiddenCount} field tersembunyi`}
            </button>
          )}
          {Object.keys(answers).length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setAnswers({})}>
              Reset
            </Button>
          )}
        </div>
      </div>

      <div className="bg-card rounded-lg border p-6 shadow-sm">
        <header className="mb-6">
          <h2 className="text-xl font-semibold tracking-tight">{schema.title || 'Tanpa judul'}</h2>
          {schema.description && (
            <p className="text-muted-foreground mt-1 text-sm">{schema.description}</p>
          )}
        </header>

        {schema.fields.length === 0 && (
          <p className="text-muted-foreground rounded-md border border-dashed px-4 py-10 text-center text-sm">
            Form masih kosong. Tambahkan field dari panel kiri.
          </p>
        )}

        <div className="flex flex-col gap-5">
          {schema.fields.map((field) => {
            const visibility = evaluation.fields[field.id];
            const isVisible = visibility?.visible ?? true;

            if (!isVisible && !showHidden) return null;

            return (
              <div
                key={field.id}
                onClick={() => onSelectField?.(field.id)}
                className={cn(
                  'rounded-md transition-colors',
                  onSelectField && 'hover:ring-muted-foreground/20 cursor-pointer hover:ring-2',
                  selectedFieldId === field.id && 'ring-primary/40 ring-2',
                  !isVisible && 'opacity-45',
                )}
              >
                {!isVisible && (
                  <p className="text-muted-foreground mb-1 flex items-center gap-1 text-[11px]">
                    <EyeOff className="size-3" />
                    Tersembunyi oleh kondisi
                  </p>
                )}

                <PreviewField
                  field={field}
                  value={answers[field.id]}
                  visibleOptionIds={visibility?.visibleOptionIds ?? []}
                  onChange={(value) => setAnswer(field.id, value)}
                />
              </div>
            );
          })}
        </div>

        {schema.fields.length > 0 && (
          <div className="mt-8">
            <Button type="button" disabled>
              {schema.settings.submitButtonLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface PreviewFieldProps {
  field: FormField;
  value: AnswerMap[string];
  visibleOptionIds: string[];
  onChange: (value: AnswerMap[string]) => void;
}

function PreviewField({ field, value, visibleOptionIds, onChange }: PreviewFieldProps) {
  const inputId = `preview-${field.id}`;
  const required = 'validation' in field && field.validation.required;
  const placeholder = 'placeholder' in field ? field.placeholder : undefined;

  if (field.type === 'section_heading') {
    const Heading = field.level === 3 ? 'h3' : 'h2';

    return (
      <div className="border-t pt-4 first:border-t-0 first:pt-0">
        <Heading className={cn('font-semibold', field.level === 3 ? 'text-base' : 'text-lg')}>
          {field.label}
        </Heading>
        {field.description && (
          <p className="text-muted-foreground mt-1 text-sm">{field.description}</p>
        )}
      </div>
    );
  }

  const label = (
    <Label htmlFor={inputId} className="mb-1.5">
      {field.label}
      {required && <span className="text-destructive">*</span>}
    </Label>
  );

  const helpText = field.helpText && (
    <p className="text-muted-foreground mt-1 text-xs">{field.helpText}</p>
  );

  const options = hasOptions(field)
    ? field.options.filter((option) => visibleOptionIds.includes(option.id))
    : [];

  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
      return (
        <div>
          {label}
          <Input
            id={inputId}
            type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
            placeholder={placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
          {helpText}
        </div>
      );

    case 'textarea':
      return (
        <div>
          {label}
          <Textarea
            id={inputId}
            rows={field.rows ?? 4}
            placeholder={placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
          {helpText}
        </div>
      );

    case 'number':
      return (
        <div>
          {label}
          <Input
            id={inputId}
            type="number"
            placeholder={placeholder}
            min={field.validation.min}
            max={field.validation.max}
            step={field.validation.integerOnly ? 1 : 'any'}
            value={typeof value === 'number' || typeof value === 'string' ? value : ''}
            onChange={(event) =>
              onChange(event.target.value === '' ? null : Number(event.target.value))
            }
          />
          {helpText}
        </div>
      );

    case 'date':
    case 'datetime':
      return (
        <div>
          {label}
          <Input
            id={inputId}
            type={field.type === 'date' ? 'date' : 'datetime-local'}
            min={field.validation.minDate}
            max={field.validation.maxDate}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
          {helpText}
        </div>
      );

    case 'select':
      return (
        <div>
          {label}
          <NativeSelect
            id={inputId}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">{placeholder || '— Pilih —'}</option>
            {options.map((option) => (
              <option key={option.id} value={optionValue(option)}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          {helpText}
        </div>
      );

    case 'radio':
      return (
        <fieldset>
          <legend className="mb-1.5 flex items-center gap-1 text-sm font-medium">
            {field.label}
            {required && <span className="text-destructive">*</span>}
          </legend>
          <div className="flex flex-col gap-2">
            {options.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={inputId}
                  className="accent-primary size-4"
                  checked={value === optionValue(option)}
                  onChange={() => onChange(optionValue(option))}
                />
                {option.label}
              </label>
            ))}
            {options.length === 0 && (
              <p className="text-muted-foreground text-xs">Semua opsi sedang tersembunyi.</p>
            )}
          </div>
          {helpText}
        </fieldset>
      );

    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];

      return (
        <fieldset>
          <legend className="mb-1.5 flex items-center gap-1 text-sm font-medium">
            {field.label}
            {required && <span className="text-destructive">*</span>}
          </legend>
          <div className="flex flex-col gap-2">
            {options.map((option) => {
              const itemValue = optionValue(option);
              const checked = selected.includes(itemValue);

              return (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
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
            {options.length === 0 && (
              <p className="text-muted-foreground text-xs">Semua opsi sedang tersembunyi.</p>
            )}
          </div>
          {helpText}
        </fieldset>
      );
    }

    case 'checkbox':
      return (
        <div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              id={inputId}
              checked={value === true}
              onCheckedChange={(next) => onChange(next === true)}
              className="mt-0.5"
            />
            <span>
              {field.label}
              {required && <span className="text-destructive">*</span>}
            </span>
          </label>
          {helpText}
        </div>
      );

    case 'file_upload':
      return (
        <div>
          {label}
          <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm">
            <Upload className="size-4" />
            <span>
              Maks {field.validation.maxFiles} berkas
              {field.validation.maxFileSizeBytes
                ? ` · ${Math.round(field.validation.maxFileSizeBytes / 1024 / 1024)} MB per berkas`
                : ''}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Unggah sebenarnya aktif di form renderer, bukan di preview.
          </p>
          {helpText}
        </div>
      );
  }
}
