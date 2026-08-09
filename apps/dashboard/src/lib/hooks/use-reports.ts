'use client';

import type { ReportGranularity, ReportOverview } from '@formz/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiError, type DownloadResult } from '../api-client';
import { saveBlob } from '../download';

export interface ReportFilters {
  formId: string;
  granularity: ReportGranularity;
  /** `YYYY-MM-DD`. */
  from?: string;
  to?: string;
}

export const reportKeys = {
  all: ['reports'] as const,
  overview: (filters: ReportFilters) => ['reports', 'overview', filters] as const,
};

function buildQuery(filters: ReportFilters): string {
  const params = new URLSearchParams({
    formId: filters.formId,
    granularity: filters.granularity,
  });

  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);

  return params.toString();
}

export function useReportOverview(filters: ReportFilters) {
  return useQuery<ReportOverview, ApiError>({
    queryKey: reportKeys.overview(filters),
    queryFn: () => apiClient.get<ReportOverview>(`/admin/reports/overview?${buildQuery(filters)}`),
    enabled: Boolean(filters.formId),
    // Menahan chart tetap tergambar saat filternya diubah, supaya halamannya
    // tidak berkedip jadi kosong lalu terisi lagi.
    placeholderData: (previous) => previous,
  });
}

/** Ekspor .xlsx. Mutation, bukan query: hasilnya berkas sekali pakai. */
export function useExportReport() {
  return useMutation<DownloadResult, ApiError, ReportFilters>({
    mutationFn: async (filters) => {
      const result = await apiClient.download(`/admin/reports/export?${buildQuery(filters)}`);

      saveBlob(result.blob, result.filename);

      return result;
    },
  });
}

export interface RefreshResponse {
  /** False berarti permintaan digabung ke refresh yang sudah antre. */
  queued: boolean;
  message: string;
}

/**
 * Meminta agregasi dihitung ulang di luar jadwal.
 *
 * Job-nya asinkron, jadi respons yang kembali baru berarti "diantrekan", bukan
 * "sudah selesai". Cache laporan sengaja **tidak** langsung dibatalkan di sini:
 * memuat ulang seketika hanya akan mengambil angka lama yang sama persis, dan
 * itu terbaca seperti tombolnya tidak berfungsi. Pemanggil yang menunggu
 * sebentar dulu sebelum memuat ulang.
 */
export function useRefreshReports() {
  const queryClient = useQueryClient();

  return useMutation<RefreshResponse, ApiError, void>({
    mutationFn: () => apiClient.post<RefreshResponse>('/admin/reports/refresh'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations', 'queues'] });
    },
  });
}
