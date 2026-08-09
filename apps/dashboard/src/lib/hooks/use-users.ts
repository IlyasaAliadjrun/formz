'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiError } from '../api-client';
import type { Paginated, UserSummary } from '../api-types';

export interface UserListFilters {
  page?: number;
  perPage?: number;
  search?: string;
  isActive?: boolean;
}

export const userKeys = {
  all: ['users'] as const,
  list: (filters: UserListFilters) => ['users', 'list', filters] as const,
};

function buildQuery(filters: UserListFilters): string {
  const params = new URLSearchParams();

  if (filters.page) params.set('page', String(filters.page));
  if (filters.perPage) params.set('perPage', String(filters.perPage));
  if (filters.search) params.set('search', filters.search);
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));

  const query = params.toString();

  return query ? `?${query}` : '';
}

export function useUserList(filters: UserListFilters) {
  return useQuery<Paginated<UserSummary>, ApiError>({
    queryKey: userKeys.list(filters),
    queryFn: () => apiClient.get<Paginated<UserSummary>>(`/admin/users${buildQuery(filters)}`),
    placeholderData: (previous) => previous,
  });
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  roleIds: string[];
  isActive: boolean;
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation<UserSummary, ApiError, CreateUserInput>({
    mutationFn: (body) => apiClient.post<UserSummary>('/admin/users', body),
    onSuccess: () => invalidate(queryClient),
  });
}

/** Field yang tidak diisi tidak dikirim sama sekali — API memperlakukan itu sebagai "jangan ubah". */
export interface UpdateUserInput {
  email?: string;
  name?: string;
  password?: string;
  roleIds?: string[];
  isActive?: boolean;
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation<UserSummary, ApiError, { id: string; body: UpdateUserInput }>({
    mutationFn: ({ id, body }) => apiClient.put<UserSummary>(`/admin/users/${id}`, body),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string>({
    mutationFn: (id) => apiClient.delete<void>(`/admin/users/${id}`),
    onSuccess: () => invalidate(queryClient),
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  // Jumlah pemegang role ikut berubah setiap user disimpan, jadi daftar role
  // ikut disegarkan — tanpa itu kolom "dipakai N user" di halaman role basi.
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: userKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['roles'] }),
  ]).then(() => undefined);
}
