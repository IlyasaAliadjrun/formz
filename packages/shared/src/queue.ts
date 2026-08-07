import { z } from 'zod';

/**
 * Nama queue BullMQ. Dipakai bersama oleh apps/api (producer) dan
 * apps/worker (consumer) supaya tidak ada string yang menyimpang.
 */
export const QUEUE_NAMES = {
  SHEET_SYNC: 'sheet-sync',
  EMAIL_NOTIFICATION: 'email-notification',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  SYNC_TO_SHEET: 'sync-to-sheet',
  SEND_NOTIFICATION: 'send-notification',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export const sheetSyncJobSchema = z.object({
  submissionId: z.string().min(1),
  formId: z.string().min(1),
  /** Dipakai sebagai idempotency key supaya retry tidak menduplikasi baris. */
  idempotencyKey: z.string().min(1),
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1),
});
export type SheetSyncJob = z.infer<typeof sheetSyncJobSchema>;

export const emailNotificationJobSchema = z.object({
  submissionId: z.string().min(1),
  formId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  to: z.array(z.email()).min(1),
  cc: z.array(z.email()).optional(),
  subject: z.string().min(1),
  templateId: z.string().optional(),
});
export type EmailNotificationJob = z.infer<typeof emailNotificationJobSchema>;

/** Opsi retry default untuk semua job (exponential backoff). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;
