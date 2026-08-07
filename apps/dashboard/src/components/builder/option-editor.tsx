'use client';

import { useState } from 'react';
import type { FieldOption, FormField } from '@formz/shared';
import { ChevronDown, ChevronRight, Eye, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createOptionId } from '@/lib/builder/field-defaults';
import { cn } from '@/lib/utils';
import { ConditionBuilder } from './condition-builder';

/**
 * Editor daftar opsi untuk select / radio / multiselect.
 *
 * Setiap opsi punya id sendiri yang tidak pernah berubah walau label-nya diedit —
 * itulah yang membuat rule kondisi tetap benar setelah label diubah.
 */
export function OptionEditor({
  options,
  availableFields,
  disabled,
  onChange,
}: {
  options: FieldOption[];
  availableFields: FormField[];
  disabled?: boolean;
  onChange: (options: FieldOption[]) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const update = (id: string, patch: Partial<FieldOption>) =>
    onChange(options.map((option) => (option.id === id ? { ...option, ...patch } : option)));

  const remove = (id: string) => onChange(options.filter((option) => option.id !== id));

  const add = () =>
    onChange([...options, { id: createOptionId(), label: `Opsi ${options.length + 1}` }]);

  return (
    <div className="flex flex-col gap-2">
      {options.map((option, index) => {
        const expanded = expandedId === option.id;
        const hasCondition = Boolean(option.conditions?.visibility);

        return (
          <div key={option.id} className="rounded-md border">
            <div className="flex items-center gap-1.5 p-1.5">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : option.id)}
                className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1"
                aria-label={expanded ? 'Tutup pengaturan opsi' : 'Buka pengaturan opsi'}
                aria-expanded={expanded}
              >
                {expanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>

              <Input
                value={option.label}
                onChange={(event) => update(option.id, { label: event.target.value })}
                className="h-8 flex-1"
                disabled={disabled}
                aria-label={`Label opsi ${index + 1}`}
              />

              {hasCondition && (
                <Eye
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-label="Opsi ini punya kondisi tampil"
                />
              )}

              <button
                type="button"
                onClick={() => remove(option.id)}
                disabled={disabled || options.length <= 1}
                className={cn(
                  'text-muted-foreground hover:text-destructive shrink-0 rounded p-1.5',
                  options.length <= 1 && 'cursor-not-allowed opacity-40',
                )}
                aria-label={`Hapus opsi ${option.label}`}
                title={options.length <= 1 ? 'Minimal satu opsi' : 'Hapus opsi'}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {expanded && (
              <div className="flex flex-col gap-3 border-t px-3 py-3">
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-muted-foreground text-[11px]"
                    htmlFor={`value-${option.id}`}
                  >
                    Nilai tersimpan (opsional — default memakai id opsi)
                  </label>
                  <Input
                    id={`value-${option.id}`}
                    value={option.value ?? ''}
                    onChange={(event) =>
                      update(option.id, { value: event.target.value || undefined })
                    }
                    placeholder={option.id}
                    className="h-8 font-mono text-xs"
                    disabled={disabled}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="text-muted-foreground text-[11px]">Kondisi tampil opsi ini</p>
                  <ConditionBuilder
                    conditions={option.conditions}
                    onChange={(conditions) => update(option.id, { conditions })}
                    availableFields={availableFields}
                    subjectLabel="Opsi ini"
                    disabled={disabled}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
        <Plus />
        Tambah opsi
      </Button>
    </div>
  );
}
