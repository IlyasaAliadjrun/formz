'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AlertCircle, Clock, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHasToken, useLogin } from '@/lib/hooks/use-auth';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasToken = useHasToken();
  const login = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // `next` hanya boleh berupa path di aplikasi ini. Tanpa pemeriksaan ini,
  // `?next=https://situs-lain.com` akan membuat halaman login kita jadi batu
  // loncatan untuk mengarahkan orang ke mana pun setelah mereka login.
  const nextParam = searchParams.get('next');
  const redirectTo = nextParam && /^\/(?!\/)/.test(nextParam) ? nextParam : '/forms';
  const sessionExpired = searchParams.get('reason') === 'expired';

  // Kalau sudah punya sesi, tidak perlu login lagi.
  useEffect(() => {
    if (hasToken) router.replace(redirectTo);
  }, [hasToken, redirectTo, router]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => router.replace(redirectTo) });
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Masuk ke Formz</CardTitle>
        <CardDescription>Gunakan akun dashboard yang sudah terdaftar.</CardDescription>
      </CardHeader>

      <CardContent>
        {/* Tanpa keterangan ini, orang yang tiba-tiba terlempar ke sini di
            tengah pekerjaan akan mengira dashboard-nya rusak. */}
        {sessionExpired && !login.isError && (
          <Alert className="mb-4">
            <Clock />
            <AlertDescription>
              <p>Sesi kamu sudah berakhir. Masuk lagi untuk melanjutkan.</p>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={login.isPending}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={login.isPending}
            />
          </div>

          {login.isError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{login.error.message}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={login.isPending} className="w-full">
            {login.isPending && <Loader2 className="animate-spin" />}
            {login.isPending ? 'Memproses...' : 'Masuk'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Suspense fallback={<Loader2 className="text-muted-foreground animate-spin" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
