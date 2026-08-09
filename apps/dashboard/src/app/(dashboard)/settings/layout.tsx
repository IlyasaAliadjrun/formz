'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldAlert, Shield, Users } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser, useHasPermission } from '@/lib/hooks/use-auth';
import { cn } from '@/lib/utils';

/**
 * Shell halaman pengaturan.
 *
 * Penjagaan permission ditaruh di layout, bukan diulang di tiap halaman —
 * halaman baru di bawah `/settings` otomatis ikut terjaga. Ini soal tampilan;
 * yang benar-benar menahan akses tetap `@RequirePermission('user.manage')` di
 * sisi API, karena apa pun yang diputuskan di browser bisa dilewati.
 */

const TABS = [
  { segment: 'users', label: 'User', Icon: Users },
  { segment: 'roles', label: 'Role & Permission', Icon: Shield },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoading } = useCurrentUser();
  const canManage = useHasPermission()('user.manage');

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Tidak punya akses</AlertTitle>
          <AlertDescription>
            <p>
              Mengelola user dan role butuh permission <code>user.manage</code>. Hubungi
              administrator kalau kamu memang seharusnya bisa membukanya.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pengaturan</h1>
          <p className="text-muted-foreground text-sm">
            Siapa saja yang bisa masuk ke dashboard, dan sejauh mana masing-masing boleh bertindak.
          </p>
        </div>

        <nav className="flex items-center gap-1" aria-label="Bagian pengaturan">
          {TABS.map(({ segment, label, Icon }) => {
            const href = `/settings/${segment}`;
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
      </header>

      {children}
    </div>
  );
}
