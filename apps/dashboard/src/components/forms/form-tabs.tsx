'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Code2, Inbox, PencilRuler } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Navigasi antar tiga halaman milik satu form. Ditaruh di komponen sendiri
 * supaya ketiganya tidak perlu saling menyalin daftar tautan — kalau nanti ada
 * halaman keempat, cukup ditambahkan di sini.
 */
const TABS = [
  { segment: 'edit', label: 'Builder', Icon: PencilRuler },
  { segment: 'submissions', label: 'Submission', Icon: Inbox },
  { segment: 'embed', label: 'Embed', Icon: Code2 },
] as const;

export function FormTabs({ formId }: { formId: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1" aria-label="Bagian form">
      {TABS.map(({ segment, label, Icon }) => {
        const href = `/forms/${formId}/${segment}`;
        // startsWith, bukan sama persis: halaman detail submission berada di
        // bawah /submissions dan tabnya harus tetap terlihat aktif.
        const active = pathname.startsWith(href);

        return (
          <Link
            key={segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
