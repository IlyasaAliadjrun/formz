'use client';

import { FIELD_TYPES, FIELD_TYPE_DEFINITIONS, type FieldType } from '@formz/shared';
import { Plus } from 'lucide-react';
import { FIELD_TYPE_ICONS } from './field-type-icons';

/**
 * Daftar tombol tambah field, satu per tipe.
 *
 * Sumbernya `FIELD_TYPES` dari @formz/shared — menambah field type baru di sana
 * otomatis memunculkannya di sini tanpa mengubah komponen ini.
 */
export function AddFieldMenu({ onAdd }: { onAdd: (type: FieldType) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
        <Plus className="size-3.5" />
        Tambah field
      </p>

      <div className="grid grid-cols-2 gap-1.5">
        {FIELD_TYPES.map((type) => {
          const definition = FIELD_TYPE_DEFINITIONS[type];
          const Icon = FIELD_TYPE_ICONS[type];

          return (
            <button
              key={type}
              type="button"
              onClick={() => onAdd(type)}
              title={definition.description}
              className="hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <Icon className="text-muted-foreground size-3.5 shrink-0" />
              <span className="truncate">{definition.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
