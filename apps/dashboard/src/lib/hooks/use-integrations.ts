'use client';

import type { EmailNotificationResult, GoogleSheetConfig, SheetSyncResult } from '@formz/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiError } from '../api-client';
import type {
  DispatchSummary,
  IntegrationSettings,
  NotificationRule,
  QueueSummary,
  SheetIntegration,
} from '../api-types';

export const integrationKeys = {
  settings: (formId: string) => ['integrations', 'settings', formId] as const,
  queues: ['integrations', 'queues'] as const,
};

/**
 * Seluruh isi halaman pengaturan datang dari satu endpoint. Memecahnya jadi
 * beberapa query berarti halaman ini punya beberapa keadaan setengah-termuat
 * yang masing-masing perlu ditangani, padahal isinya selalu dibutuhkan bersamaan.
 */
export function useIntegrationSettings(formId: string) {
  return useQuery<IntegrationSettings, ApiError>({
    queryKey: integrationKeys.settings(formId),
    queryFn: () =>
      apiClient.get<IntegrationSettings>(`/admin/forms/${formId}/integration-settings`),
    enabled: Boolean(formId),
  });
}

export function useQueueSummary() {
  return useQuery<QueueSummary, ApiError>({
    queryKey: integrationKeys.queues,
    queryFn: () => apiClient.get<QueueSummary>('/admin/queues/summary'),
    // Job berjalan di belakang layar; tanpa refetch berkala, angka "gagal" di
    // layar tidak pernah berubah sampai halamannya dimuat ulang.
    refetchInterval: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Integrasi Google Sheet
// ---------------------------------------------------------------------------

export interface SheetIntegrationInput {
  config: GoogleSheetConfig;
  isActive: boolean;
}

export function useSaveSheetIntegration(formId: string) {
  const queryClient = useQueryClient();

  return useMutation<
    SheetIntegration,
    ApiError,
    { integrationId?: string; body: SheetIntegrationInput }
  >({
    mutationFn: ({ integrationId, body }) =>
      integrationId
        ? apiClient.put<SheetIntegration>(
            `/admin/forms/${formId}/integrations/${integrationId}`,
            body,
          )
        : apiClient.post<SheetIntegration>(`/admin/forms/${formId}/integrations`, body),
    onSuccess: () => invalidate(queryClient, formId),
  });
}

export function useDeleteSheetIntegration(formId: string) {
  const queryClient = useQueryClient();

  return useMutation<{ id: string }, ApiError, string>({
    mutationFn: (integrationId) =>
      apiClient.delete<{ id: string }>(`/admin/forms/${formId}/integrations/${integrationId}`),
    onSuccess: () => invalidate(queryClient, formId),
  });
}

export function useTestSheetIntegration(formId: string) {
  return useMutation<SheetSyncResult, ApiError, string>({
    mutationFn: (integrationId) =>
      apiClient.post<SheetSyncResult>(`/admin/forms/${formId}/integrations/${integrationId}/test`),
  });
}

// ---------------------------------------------------------------------------
// Aturan notifikasi
// ---------------------------------------------------------------------------

export type NotificationRuleInput = Pick<
  NotificationRule,
  | 'name'
  | 'subject'
  | 'emailTemplateId'
  | 'condition'
  | 'recipients'
  | 'recipientFieldIds'
  | 'recipientRules'
  | 'isActive'
>;

export function useSaveNotificationRule(formId: string) {
  const queryClient = useQueryClient();

  return useMutation<NotificationRule, ApiError, { ruleId?: string; body: NotificationRuleInput }>({
    mutationFn: ({ ruleId, body }) =>
      ruleId
        ? apiClient.put<NotificationRule>(
            `/admin/forms/${formId}/notification-rules/${ruleId}`,
            body,
          )
        : apiClient.post<NotificationRule>(`/admin/forms/${formId}/notification-rules`, body),
    onSuccess: () => invalidate(queryClient, formId),
  });
}

export function useDeleteNotificationRule(formId: string) {
  const queryClient = useQueryClient();

  return useMutation<{ id: string }, ApiError, string>({
    mutationFn: (ruleId) =>
      apiClient.delete<{ id: string }>(`/admin/forms/${formId}/notification-rules/${ruleId}`),
    onSuccess: () => invalidate(queryClient, formId),
  });
}

export function useTestNotificationRule(formId: string) {
  return useMutation<EmailNotificationResult, ApiError, { ruleId: string; to?: string }>({
    mutationFn: ({ ruleId, to }) =>
      apiClient.post<EmailNotificationResult>(
        `/admin/forms/${formId}/notification-rules/${ruleId}/test`,
        to ? { to } : {},
      ),
  });
}

// ---------------------------------------------------------------------------
// Retry manual
// ---------------------------------------------------------------------------

/** Mengantre ulang sync & notifikasi untuk satu submission yang gagal diproses. */
export function useRetrySubmissionIntegrations(submissionId: string) {
  const queryClient = useQueryClient();

  return useMutation<DispatchSummary, ApiError, void>({
    mutationFn: () =>
      apiClient.post<DispatchSummary>(`/admin/submissions/${submissionId}/integrations/retry`),
    onSuccess: () => {
      // Job berjalan asinkron, jadi status barunya belum tentu sudah tercatat
      // saat respons ini kembali. Yang dijamin cuma satu: pengguna akan menekan
      // tombol muat ulang kalau statusnya belum berubah, dan data lama tidak
      // boleh bertahan di cache sampai saat itu.
      void queryClient.invalidateQueries({ queryKey: ['submissions'] });
      void queryClient.invalidateQueries({ queryKey: integrationKeys.queues });
    },
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>, formId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: integrationKeys.settings(formId) });
}
