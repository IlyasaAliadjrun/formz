'use client';

import type { FormSchema, FormStatus } from '@formz/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiError } from '../api-client';
import type { DeleteFormResult, FormDetail, FormSummary, Paginated } from '../api-types';

export interface FormListFilters {
  page?: number;
  perPage?: number;
  status?: FormStatus;
  search?: string;
}

export const formKeys = {
  all: ['forms'] as const,
  list: (filters: FormListFilters) => ['forms', 'list', filters] as const,
  detail: (id: string) => ['forms', 'detail', id] as const,
};

function buildQuery(filters: FormListFilters): string {
  const params = new URLSearchParams();

  if (filters.page) params.set('page', String(filters.page));
  if (filters.perPage) params.set('perPage', String(filters.perPage));
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);

  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useFormList(filters: FormListFilters) {
  return useQuery<Paginated<FormSummary>, ApiError>({
    queryKey: formKeys.list(filters),
    queryFn: () => apiClient.get<Paginated<FormSummary>>(`/admin/forms${buildQuery(filters)}`),
    placeholderData: (previous) => previous,
  });
}

export function useForm(id: string) {
  return useQuery<FormDetail, ApiError>({
    queryKey: formKeys.detail(id),
    queryFn: () => apiClient.get<FormDetail>(`/admin/forms/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateForm() {
  const queryClient = useQueryClient();

  return useMutation<FormDetail, ApiError, { title: string; description?: string }>({
    mutationFn: (body) => apiClient.post<FormDetail>('/admin/forms', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: formKeys.all }),
  });
}

export function useSaveDraft(id: string) {
  const queryClient = useQueryClient();

  return useMutation<FormDetail, ApiError, { title?: string; schema?: FormSchema }>({
    mutationFn: (body) => apiClient.put<FormDetail>(`/admin/forms/${id}`, body),
    onSuccess: (data) => {
      queryClient.setQueryData(formKeys.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: ['forms', 'list'] });
    },
  });
}

export function usePublishForm(id: string) {
  const queryClient = useQueryClient();

  return useMutation<FormDetail, ApiError, void>({
    mutationFn: () => apiClient.post<FormDetail>(`/admin/forms/${id}/publish`, {}),
    onSuccess: (data) => {
      queryClient.setQueryData(formKeys.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: ['forms', 'list'] });
    },
  });
}

export function useDeleteForm() {
  const queryClient = useQueryClient();

  return useMutation<DeleteFormResult, ApiError, string>({
    mutationFn: (id) => apiClient.delete<DeleteFormResult>(`/admin/forms/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: formKeys.all }),
  });
}

export function useUpdateEmbedSettings(id: string) {
  const queryClient = useQueryClient();

  return useMutation<FormSummary, ApiError, { allowedDomains: string[] }>({
    mutationFn: (body) => apiClient.put<FormSummary>(`/admin/forms/${id}/embed-settings`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: ['forms', 'list'] });
    },
  });
}
