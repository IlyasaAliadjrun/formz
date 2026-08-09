'use client';

import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import type { AuthenticatedUser, PermissionKey } from '@formz/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiError } from '../api-client';
import { authStore } from '../auth-store';

/** Menandai apakah browser sedang memegang token, tanpa mismatch saat SSR. */
export function useHasToken(): boolean {
  return useSyncExternalStore(
    (listener) => authStore.subscribe(listener),
    () => authStore.getAccessToken() !== null || authStore.getRefreshToken() !== null,
    // Di server selalu false; komponen yang memakainya dirender di client.
    () => false,
  );
}

export function useCurrentUser() {
  const hasToken = useHasToken();

  return useQuery<AuthenticatedUser, ApiError>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.me(),
    enabled: hasToken,
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      apiClient.login(email, password),
    onSuccess: (data) => {
      authStore.setTokens(data.tokens);
      queryClient.setQueryData(['auth', 'me'], data.user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => apiClient.logout(),
    onSettled: () => {
      queryClient.clear();
      router.replace('/login');
    },
  });
}

/**
 * Cek permission dari daftar yang dibawa `GET /admin/auth/me`.
 *
 * Parameternya bertipe `PermissionKey`, bukan `string`, supaya salah ketik nama
 * permission ketahuan saat compile — sama seperti `@RequirePermission()` di API.
 * Permission yang salah ketik akan selalu mengembalikan false, artinya tombolnya
 * hilang diam-diam dan tidak ada yang menyadarinya sampai ada yang melapor.
 *
 * Ini hanya menentukan **tampilan**. Penegakan sesungguhnya ada di guard API,
 * karena apa pun yang diputuskan di browser bisa dilewati.
 */
export function useHasPermission(): (permission: PermissionKey) => boolean {
  const { data: user } = useCurrentUser();

  return (permission: PermissionKey) => user?.permissions.includes(permission) ?? false;
}
