import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Halaman tidak ditemukan</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Alamat yang kamu buka tidak ada di dashboard ini.
        </p>
      </div>
      <Button asChild>
        <Link href="/forms">Kembali ke daftar form</Link>
      </Button>
    </main>
  );
}
