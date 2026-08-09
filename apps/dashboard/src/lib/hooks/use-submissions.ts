'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient, type ApiError, type DownloadResult } from '../api-client';
import type { SubmissionDetail, SubmissionListResult } from '../api-types';

export interface SubmissionFilters {
  formId: string;
  page?: number;
  perPage?: number;
  /** `YYYY-MM-DD`, dilebarkan server jadi rentang sehari penuh. */
  from?: string;
  to?: string;
}

export const submissionKeys = {
  all: ['submissions'] as const,
  list: (filters: SubmissionFilters) => ['submissions', 'list', filters] as const,
  detail: (id: string) => ['submissions', 'detail', id] as const,
};

function buildQuery(filters: SubmissionFilters): string {
  const params = new URLSearchParams({ formId: filters.formId });

  if (filters.page) params.set('page', String(filters.page));
  if (filters.perPage) params.set('perPage', String(filters.perPage));
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);

  return params.toString();
}

export function useSubmissionList(filters: SubmissionFilters) {
  return useQuery<SubmissionListResult, ApiError>({
    queryKey: submissionKeys.list(filters),
    queryFn: () => apiClient.get<SubmissionListResult>(`/admin/submissions?${buildQuery(filters)}`),
    enabled: Boolean(filters.formId),
    // Menahan tabel tetap terisi saat pindah halaman, supaya tidak berkedip
    // jadi kosong lalu terisi lagi.
    placeholderData: (previous) => previous,
  });
}

export function useSubmission(id: string) {
  return useQuery<SubmissionDetail, ApiError>({
    queryKey: submissionKeys.detail(id),
    queryFn: () => apiClient.get<SubmissionDetail>(`/admin/submissions/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Ekspor dijalankan sebagai mutation, bukan query: hasilnya berkas sekali pakai
 * yang tidak boleh di-cache atau dijalankan ulang otomatis saat komponen render.
 */
export function useExportSubmissions() {
  return useMutation<
    DownloadResult,
    ApiError,
    { formId: string; format: 'xlsx' | 'csv'; from?: string; to?: string }
  >({
    mutationFn: async ({ format, ...filters }) => {
      const result = await apiClient.download(
        `/admin/submissions/export?${buildQuery(filters)}&format=${format}`,
      );

      saveBlob(result.blob, result.filename);

      return result;
    },
  });
}

/** Memicu unduhan dari Blob yang sudah ada di memori browser. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Object URL menahan blob-nya di memori sampai dicabut.
  URL.revokeObjectURL(url);
}
