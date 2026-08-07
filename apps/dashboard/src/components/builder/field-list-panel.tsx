'use client';

import {
  FIELD_TYPE_DEFINITIONS,
  type FieldType,
  type FormField,
  type SchemaIssue,
} from '@formz/shared';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, Copy, Eye, GripVertical, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FIELD_TYPE_ICONS } from './field-type-icons';

interface FieldListPanelProps {
  fields: FormField[];
  selectedFieldId: string | null;
  issuesByField: Map<string, SchemaIssue[]>;
  readOnly: boolean;
  onSelect: (fieldId: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onDuplicate: (fieldId: string) => void;
  onRemove: (fieldId: string) => void;
}

export function FieldListPanel({
  fields,
  selectedFieldId,
  issuesByField,
  readOnly,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
}: FieldListPanelProps) {
  // PointerSensor dengan jarak aktivasi 6px supaya klik untuk memilih field
  // tidak ikut terbaca sebagai awal drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const from = fields.findIndex((field) => field.id === active.id);
    const to = fields.findIndex((field) => field.id === over.id);

    if (from !== -1 && to !== -1) onMove(from, to);
  };

  if (fields.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed px-3 py-8 text-center text-sm">
        Belum ada field. Tambahkan dari daftar di bawah.
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={fields.map((field) => field.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-1.5">
          {fields.map((field) => (
            <SortableFieldItem
              key={field.id}
              field={field}
              selected={field.id === selectedFieldId}
              issues={issuesByField.get(field.id) ?? []}
              readOnly={readOnly}
              onSelect={() => onSelect(field.id)}
              onDuplicate={() => onDuplicate(field.id)}
              onRemove={() => onRemove(field.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

interface SortableFieldItemProps {
  field: FormField;
  selected: boolean;
  issues: SchemaIssue[];
  readOnly: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

function SortableFieldItem({
  field,
  selected,
  issues,
  readOnly,
  onSelect,
  onDuplicate,
  onRemove,
}: SortableFieldItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    disabled: readOnly,
  });

  const Icon = FIELD_TYPE_ICONS[field.type as FieldType];
  const definition = FIELD_TYPE_DEFINITIONS[field.type as FieldType];
  const isRequired = 'validation' in field && field.validation.required;
  const hasConditions = Boolean(field.conditions?.visibility);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'bg-background flex items-center gap-1.5 rounded-md border px-1.5 py-1.5 transition-colors',
        selected && 'border-primary ring-primary/20 ring-2',
        isDragging && 'z-10 opacity-80 shadow-lg',
      )}
    >
      <button
        type="button"
        className={cn(
          'text-muted-foreground hover:text-foreground shrink-0 cursor-grab touch-none rounded p-1 active:cursor-grabbing',
          readOnly && 'cursor-not-allowed opacity-40',
        )}
        aria-label={`Ubah urutan ${field.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left"
      >
        <Icon className="text-muted-foreground size-3.5 shrink-0" />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="truncate text-sm">{field.label}</span>
            {isRequired && (
              <span className="text-destructive shrink-0" title="Wajib diisi">
                *
              </span>
            )}
          </span>
          <span className="text-muted-foreground block truncate text-[11px]">
            {definition.label} · {field.name}
          </span>
        </span>

        {hasConditions && (
          <Eye
            className="text-muted-foreground size-3.5 shrink-0"
            aria-label="Punya kondisi tampil"
          />
        )}

        {issues.length > 0 && (
          <AlertCircle
            className="text-destructive size-3.5 shrink-0"
            aria-label={`${issues.length} masalah`}
          />
        )}
      </button>

      {!readOnly && (
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={onDuplicate}
            className="text-muted-foreground hover:text-foreground rounded p-1"
            aria-label={`Duplikat ${field.label}`}
            title="Duplikat"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive rounded p-1"
            aria-label={`Hapus ${field.label}`}
            title="Hapus"
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      )}
    </li>
  );
}
