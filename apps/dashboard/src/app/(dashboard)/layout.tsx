'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { PermissionKey } from '@formz/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, LogOut, Loader2, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCurrentUser, useHasPermission, useHasToken, useLogout } from '@/lib/hooks/use-auth';
import { cn } from '@/lib/utils';

/**
 * Shell dashboard sekaligus penjaga rute.
 *
 * Proteksi dilakukan di client karena token disimpan di browser — middleware
 * Next.js tidak bisa membacanya. API tetap menolak request tanpa token yang sah,
 * jadi guard ini soal pengalaman pengguna, bukan lapisan keamanan.
 */

/** Menu utama. `permission` null berarti terbuka untuk semua yang sudah login. */
const NAV_ITEMS: Array<{
  href: string;
  label: string;
  Icon: typeof FileText;
  permission: PermissionKey | null;
}> = [
  { href: '/forms', label: 'Form', Icon: FileText, permission: 'form.view' },
  { href: '/settings', label: 'Pengaturan', Icon: Settings, permission: 'user.manage' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const hasToken = useHasToken();
  const { data: user, isLoading, isError, error } = useCurrentUser();
  const hasPermission = useHasPermission();
  const queryClient = useQueryClient();
  const logout = useLogout();

  useEffect(() => {
    if (!hasToken) {
      router.replace(loginUrl(pathname, 'expired'));
    }
  }, [hasToken, pathname, router]);

  // Token ada tapi ditolak server (dicabut, kedaluwarsa, atau user dinonaktifkan).
  useEffect(() => {
    if (!hasToken || !isError) return;

    // 401 = sesinya yang bermasalah; selain itu (API mati, jaringan putus)
    // melempar orang ke halaman login hanya menyembunyikan penyebab sebenarnya.
    if (error?.status === 401 || error?.status === 403) {
      // Data milik sesi lama tidak boleh sempat terlihat oleh siapa pun yang
      // login berikutnya di browser yang sama.
      queryClient.clear();
      router.replace(loginUrl(pathname, 'expired'));
    }
  }, [hasToken, isError, error, pathname, queryClient, router]);

  if (!hasToken || isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
        <span className="sr-only">Memuat sesi...</span>
      </div>
    );
  }

  // Sesi ditolak dan redirect sedang berjalan — jangan sempat merender isi halaman.
  if (isError && (error?.status === 401 || error?.status === 403)) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
        <span className="sr-only">Mengalihkan ke halaman login...</span>
      </div>
    );
  }

  const visibleNav = NAV_ITEMS.filter(
    (item) => item.permission === null || hasPermission(item.permission),
  );

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background sticky top-0 z-40 border-b">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-6 px-6">
          <Link href="/forms" className="flex items-center gap-2 font-semibold">
            <FileText className="size-5" />
            Formz
          </Link>

          <nav className="flex items-center gap-1 text-sm" aria-label="Menu utama">
            {visibleNav.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname.startsWith(href) ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5',
                  pathname.startsWith(href)
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium">{user?.name}</p>
              <p className="text-muted-foreground text-xs leading-tight">
                {user?.roles.map((role) => role.name).join(', ') || 'Tanpa role'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              aria-label="Keluar"
              title="Keluar"
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}

/**
 * Membawa serta halaman yang sedang dibuka supaya bisa dikembalikan setelah
 * login, plus alasannya supaya halaman login bisa menjelaskan kenapa orangnya
 * tiba-tiba ada di sana.
 */
function loginUrl(pathname: string, reason: 'expired'): string {
  return `/login?next=${encodeURIComponent(pathname)}&reason=${reason}`;
}
