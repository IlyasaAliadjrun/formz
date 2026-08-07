import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Select berbasis elemen `<select>` bawaan, bukan Radix.
 *
 * Panel properti builder berisi belasan dropdown kecil; memakai listbox custom
 * di semuanya menambah bundle dan kompleksitas tanpa manfaat nyata di sini —
 * select bawaan sudah aksesibel dan bekerja baik di mobile.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          'border-input bg-background flex h-9 w-full appearance-none rounded-md border px-3 py-1 pr-8 text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
    </div>
  );
}

export { NativeSelect };
