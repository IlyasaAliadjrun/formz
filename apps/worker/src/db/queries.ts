import { formSchemaSchema, type AnswerMap, type FormSchema } from '@formz/shared';
import { pool } from '../connections';

/**
 * Akses database worker, ditulis sebagai SQL langsung memakai `pg`.
 *
 * Worker sengaja **tidak** memakai Prisma Client seperti apps/api. Alasannya:
 * client-nya di-generate ke dalam `apps/api/src/generated`, jadi memakainya dari
 * sini berarti worker mengimpor isi perut aplikasi lain — atau schema Prisma-nya
 * harus dipindah ke paket tersendiri. Yang dibutuhkan worker hanya enam query
 * yang bentuknya tetap, dan salah satunya (upsert log) justru lebih tepat
 * ditulis sebagai satu pernyataan SQL karena bagian `ON CONFLICT ... WHERE`-nya
 * yang menjadi kunci idempotency. Kalau nanti worker perlu akses tabel yang jauh
 * lebih luas, pemindahan schema ke `packages/db` baru sepadan.
 */

export type LogType = 'sheet' | 'email';

export interface SubmissionContext {
  submissionId: string;
  formId: string;
  formTitle: string;
  formKey: string;
  versionNumber: number;
  submittedAt: Date;
  sourceDomain: string | null;
  answers: AnswerMap;
  schema: FormSchema;
}

/** Jawaban + schema versi submission itu sendiri, bukan versi form terbaru. */
export async function loadSubmissionContext(
  submissionId: string,
): Promise<SubmissionContext | null> {
  const { rows } = await pool.query<{
    id: string;
    form_id: string;
    title: string;
    form_key: string;
    version_number: number;
    submitted_at: Date;
    source_domain: string | null;
    answers: unknown;
    schema: unknown;
  }>(
    `SELECT s.id,
            s.form_id,
            f.title,
            f.form_key,
            v.version_number,
            s.submitted_at,
            s.source_domain,
            s.answers,
            v.schema
       FROM submissions s
       JOIN forms f ON f.id = s.form_id
       JOIN form_versions v ON v.id = s.form_version_id
      WHERE s.id = $1`,
    [submissionId],
  );

  const row = rows[0];

  if (!row) return null;

  return {
    submissionId: row.id,
    formId: row.form_id,
    formTitle: row.title,
    formKey: row.form_key,
    versionNumber: row.version_number,
    submittedAt: row.submitted_at,
    sourceDomain: row.source_domain,
    answers: (row.answers ?? {}) as AnswerMap,
    schema: formSchemaSchema.parse(row.schema),
  };
}

export interface FormContext {
  formId: string;
  formTitle: string;
  formKey: string;
  versionNumber: number;
  schema: FormSchema;
}

/**
 * Bentuk form yang sedang berlaku, dipakai job uji coba yang belum punya
 * submission. Versi terpublish didahulukan; kalau belum pernah dipublish, versi
 * draft terakhir dipakai supaya tombol uji coba tetap berguna saat form masih
 * disiapkan.
 */
export async function loadFormContext(formId: string): Promise<FormContext | null> {
  const { rows } = await pool.query<{
    id: string;
    title: string;
    form_key: string;
    version_number: number;
    schema: unknown;
  }>(
    `SELECT f.id, f.title, f.form_key, v.version_number, v.schema
       FROM forms f
       JOIN form_versions v ON v.form_id = f.id
      WHERE f.id = $1
      ORDER BY (v.published_at IS NOT NULL) DESC, v.version_number DESC
      LIMIT 1`,
    [formId],
  );

  const row = rows[0];

  if (!row) return null;

  return {
    formId: row.id,
    formTitle: row.title,
    formKey: row.form_key,
    versionNumber: row.version_number,
    schema: formSchemaSchema.parse(row.schema),
  };
}

export interface IntegrationRow {
  id: string;
  formId: string;
  isActive: boolean;
  config: unknown;
}

export async function loadIntegration(integrationId: string): Promise<IntegrationRow | null> {
  const { rows } = await pool.query<{
    id: string;
    form_id: string;
    is_active: boolean;
    config: unknown;
  }>(
    `SELECT id, form_id, is_active, config
       FROM integrations
      WHERE id = $1 AND type = 'google_sheet'`,
    [integrationId],
  );

  const row = rows[0];

  return row
    ? { id: row.id, formId: row.form_id, isActive: row.is_active, config: row.config }
    : null;
}

export interface NotificationRuleRow {
  id: string;
  formId: string;
  name: string | null;
  subject: string | null;
  emailTemplateId: string | null;
  isActive: boolean;
}

export async function loadNotificationRule(ruleId: string): Promise<NotificationRuleRow | null> {
  const { rows } = await pool.query<{
    id: string;
    form_id: string;
    name: string | null;
    subject: string | null;
    email_template_id: string | null;
    is_active: boolean;
  }>(
    `SELECT id, form_id, name, subject, email_template_id, is_active
       FROM notification_rules
      WHERE id = $1`,
    [ruleId],
  );

  const row = rows[0];

  return row
    ? {
        id: row.id,
        formId: row.form_id,
        name: row.name,
        subject: row.subject,
        emailTemplateId: row.email_template_id,
        isActive: row.is_active,
      }
    : null;
}

// ---------------------------------------------------------------------------
// submission_integration_logs
// ---------------------------------------------------------------------------

export interface LogHandle {
  id: string;
  retryCount: number;
}

/**
 * Menandai satu pekerjaan sebagai sedang berjalan — sekaligus memutuskan apakah
 * pekerjaan itu masih perlu dijalankan.
 *
 * Satu pernyataan ini yang menjadi kunci idempotency (ARCHITECTURE.md bagian 6
 * poin 3). `ON CONFLICT` menabrak unique index `(submission_id, type, target)`
 * dari Part 1, dan `WHERE status <> 'success'` membuat baris yang sudah berhasil
 * **tidak** ikut ter-update — sehingga `RETURNING` tidak mengembalikan apa pun
 * dan pemanggil tahu pekerjaannya sudah pernah tuntas. Pemeriksaan dan penandaan
 * terjadi dalam satu operasi atomik, jadi dua percobaan yang berbarengan tidak
 * bisa sama-sama lolos pemeriksaan lalu sama-sama menulis.
 *
 * `retry_count` naik pada setiap percobaan ulang, bukan pada percobaan pertama.
 *
 * `id` diisi `gen_random_uuid()` (UUIDv4) karena default `uuid(7)` milik Prisma
 * dihasilkan di sisi aplikasi, bukan di database. Untuk tabel log yang tidak
 * pernah di-scan berurutan, keterurutan UUIDv7 tidak memberi keuntungan apa pun.
 */
export async function beginLog(
  submissionId: string,
  type: LogType,
  target: string,
): Promise<LogHandle | null> {
  const { rows } = await pool.query<{ id: string; retry_count: number }>(
    `INSERT INTO submission_integration_logs
            (id, submission_id, type, target, status, retry_count, updated_at)
     VALUES (gen_random_uuid(), $1, $2::integration_log_type, $3, 'pending', 0, now())
     ON CONFLICT (submission_id, type, target) DO UPDATE
        SET status = 'pending',
            retry_count = submission_integration_logs.retry_count + 1,
            updated_at = now()
      WHERE submission_integration_logs.status <> 'success'
     RETURNING id, retry_count`,
    [submissionId, type, target],
  );

  const row = rows[0];

  return row ? { id: row.id, retryCount: row.retry_count } : null;
}

export async function markLogSuccess(logId: string): Promise<void> {
  await pool.query(
    `UPDATE submission_integration_logs
        SET status = 'success', synced_at = now(), error_message = NULL, updated_at = now()
      WHERE id = $1`,
    [logId],
  );
}

export async function markLogFailed(logId: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE submission_integration_logs
        SET status = 'failed', error_message = $2, updated_at = now()
      WHERE id = $1`,
    // Pesan error dari Google/SMTP bisa sangat panjang; dipotong supaya satu
    // kegagalan tidak menyimpan kilobyte teks per submission.
    [logId, message.slice(0, 1000)],
  );
}
