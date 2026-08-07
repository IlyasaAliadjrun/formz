'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FileText, LogOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCurrentUser, useHasToken, useLogout } from '@/lib/hooks/use-auth';

/**
 * Shell dashboard sekaligus penjaga rute.
 *
 * Proteksi dilakukan di client karena token disimpan di browser — middleware
 * Next.js tidak bisa membacanya. API tetap menolak request tanpa token yang sah,
 * jadi guard ini soal pengalaman pengguna, bukan lapisan keamanan.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const hasToken = useHasToken();
  const { data: user, isLoading, isError } = useCurrentUser();
  const logout = useLogout();

  useEffect(() => {
    if (!hasToken) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [hasToken, pathname, router]);

  // Token ada tapi ditolak server (dicabut / user dinonaktifkan).
  useEffect(() => {
    if (hasToken && isError) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [hasToken, isError, pathname, router]);

  if (!hasToken || isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
        <span className="sr-only">Memuat sesi...</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background sticky top-0 z-40 border-b">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-6 px-6">
          <Link href="/forms" className="flex items-center gap-2 font-semibold">
            <FileText className="size-5" />
            Formz
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/forms"
              className={
                pathname.startsWith('/forms')
                  ? 'bg-accent text-accent-foreground rounded-md px-3 py-1.5'
                  : 'text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5'
              }
            >
              Form
            </Link>
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
