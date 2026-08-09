'use client';

import type { PermissionDefinition } from '@formz/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiError } from '../api-client';
import type { RoleSummary } from '../api-types';

export const roleKeys = {
  all: ['roles'] as const,
  list: ['roles', 'list'] as const,
  permissions: ['roles', 'permissions'] as const,
};

export function useRoleList() {
  return useQuery<{ data: RoleSummary[] }, ApiError>({
    queryKey: roleKeys.list,
    queryFn: () => apiClient.get<{ data: RoleSummary[] }>('/admin/roles'),
  });
}

/**
 * Katalog permission diambil dari server, bukan diimpor langsung dari
 * `@formz/shared`.
 *
 * Katalog di paket shared adalah apa yang **seharusnya** ada; isi tabel
 * `permissions` adalah apa yang **benar-benar** bisa diberikan ke role. Keduanya
 * bisa berbeda kalau seed belum dijalankan setelah katalog bertambah, dan
 * mencentang permission yang belum ada barisnya akan gagal saat disimpan.
 * Mengambilnya dari server membuat perbedaan itu terlihat, bukan jadi kejutan.
 */
export function usePermissionCatalog() {
  return useQuery<{ data: PermissionDefinition[] }, ApiError>({
    queryKey: roleKeys.permissions,
    queryFn: () => apiClient.get<{ data: PermissionDefinition[] }>('/admin/roles/permissions'),
    // Katalog hanya berubah saat aplikasinya sendiri di-deploy ulang.
    staleTime: 10 * 60_000,
  });
}

export interface RoleInput {
  name: string;
  description?: string;
  permissionKeys: string[];
}

export function useSaveRole() {
  const queryClient = useQueryClient();

  return useMutation<RoleSummary, ApiError, { id?: string; body: RoleInput }>({
    mutationFn: ({ id, body }) =>
      id
        ? apiClient.put<RoleSummary>(`/admin/roles/${id}`, body)
        : apiClient.post<RoleSummary>('/admin/roles', body),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();

  return useMutation<{ id: string }, ApiError, string>({
    mutationFn: (id) => apiClient.delete<{ id: string }>(`/admin/roles/${id}`),
    onSuccess: () => invalidate(queryClient),
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: roleKeys.all }),
    // Nama role muncul di daftar user, jadi ikut disegarkan.
    queryClient.invalidateQueries({ queryKey: ['users'] }),
  ]).then(() => undefined);
}
