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

/**
 * `test` dipakai tombol "Test Kirim" di dashboard: job-nya melewati processor
 * yang sama persis dengan job sungguhan — kredensial, konfigurasi, dan
 * rendering yang diuji adalah yang benar-benar dipakai nanti — hanya saja
 * datanya contoh dan hasilnya tidak dicatat ke submission_integration_logs.
 */
export const jobModeSchema = z.enum(['live', 'test']);
export type JobMode = z.infer<typeof jobModeSchema>;

/**
 * Payload sengaja hanya memuat *rujukan*, bukan salinan konfigurasi.
 * Worker memuat sendiri config integrasi dan jawaban submission dari database,
 * jadi job yang tertahan lama di antrean tetap memakai konfigurasi terbaru
 * alih-alih konfigurasi saat job dibuat.
 */
export const sheetSyncJobSchema = z.object({
  mode: jobModeSchema.prefault('live'),
  formId: z.string().min(1),
  integrationId: z.string().min(1),
  /** Null hanya pada mode test — datanya dibuat contoh oleh worker. */
  submissionId: z.string().min(1).nullable().prefault(null),
});
export type SheetSyncJob = z.infer<typeof sheetSyncJobSchema>;

export const emailNotificationJobSchema = z.object({
  mode: jobModeSchema.prefault('live'),
  formId: z.string().min(1),
  notificationRuleId: z.string().min(1),
  submissionId: z.string().min(1).nullable().prefault(null),
  /**
   * Penerima dihitung di API, bukan di worker: hanya API yang bisa memastikan
   * satu alamat tidak dikirimi dua kali ketika sebuah submission cocok dengan
   * lebih dari satu aturan notifikasi sekaligus.
   */
  recipients: z.array(z.email()).min(1).max(100),
});
export type EmailNotificationJob = z.infer<typeof emailNotificationJobSchema>;

/**
 * Id job dipakai sebagai kunci deduplikasi BullMQ: selama job dengan id yang
 * sama masih ada di Redis (menunggu, berjalan, atau gagal), `add` yang kedua
 * diabaikan. Ini lapis pertama idempotency; lapis keduanya ada di database
 * lewat unique index pada submission_integration_logs.
 */
export function sheetSyncJobId(submissionId: string, integrationId: string): string {
  return `sheet:${submissionId}:${integrationId}`;
}

export function emailNotificationJobId(submissionId: string, ruleId: string): string {
  return `email:${submissionId}:${ruleId}`;
}

/** Opsi retry default untuk semua job (exponential backoff). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/**
 * Job uji coba tidak boleh mengantre berulang kali: yang menekan tombolnya
 * sedang menunggu jawabannya di layar, dan kegagalannya memang mau dilihat.
 */
export const TEST_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 300 },
  removeOnFail: { age: 300 },
} as const;
