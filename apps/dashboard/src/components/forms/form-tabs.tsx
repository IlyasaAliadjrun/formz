'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PermissionKey } from '@formz/shared';
import { Code2, Inbox, PencilRuler, Workflow } from 'lucide-react';
import { useHasPermission } from '@/lib/hooks/use-auth';
import { cn } from '@/lib/utils';

/**
 * Navigasi antar halaman milik satu form. Ditaruh di komponen sendiri supaya
 * keempatnya tidak perlu saling menyalin daftar tautan — kalau nanti ada halaman
 * kelima, cukup ditambahkan di sini.
 *
 * Tab yang permission-nya tidak dimiliki **tidak dirender sama sekali**, bukan
 * dirender lalu dimatikan: tab mati mengundang orang mengira ada yang rusak,
 * sementara halaman tujuannya memang bukan untuk mereka. Untuk tombol aksi di
 * dalam halaman, pilihannya kebalikan — di sana tombol yang hilang justru bikin
 * bingung, jadi yang dipakai `disabled` plus keterangan permission-nya.
 */
const TABS: Array<{
  segment: string;
  label: string;
  Icon: typeof PencilRuler;
  permission: PermissionKey;
}> = [
  { segment: 'edit', label: 'Builder', Icon: PencilRuler, permission: 'form.view' },
  { segment: 'submissions', label: 'Submission', Icon: Inbox, permission: 'submission.view' },
  { segment: 'integrations', label: 'Integrasi', Icon: Workflow, permission: 'integration.manage' },
  { segment: 'embed', label: 'Embed', Icon: Code2, permission: 'form.view' },
];

export function FormTabs({ formId }: { formId: string }) {
  const pathname = usePathname();
  const hasPermission = useHasPermission();

  const visible = TABS.filter((tab) => hasPermission(tab.permission));

  return (
    <nav className="flex items-center gap-1" aria-label="Bagian form">
      {visible.map(({ segment, label, Icon }) => {
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
