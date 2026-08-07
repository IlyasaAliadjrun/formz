'use client';

import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Halaman gagal dimuat</AlertTitle>
        <AlertDescription>
          <p>{error.message || 'Terjadi kesalahan yang tidak terduga.'}</p>
          <Button variant="outline" size="sm" onClick={reset}>
            Coba lagi
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
