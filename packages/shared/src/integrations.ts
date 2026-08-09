import { z } from 'zod';
import { conditionGroupSchema, type ConditionGroup } from './conditions';
import { matchesConditionGroup, type AnswerMap } from './condition-evaluator';
import { getInputFields, type FormSchema } from './form-schema';

/**
 * Konfigurasi integrasi & notifikasi per form.
 *
 * Isi kolom JSONB `integrations.config` dan bentuk `notification_rules` divalidasi
 * dari sini — satu definisi yang dipakai bertiga: API (saat menyimpan konfigurasi),
 * worker (saat menjalankan job), dan dashboard (saat merender formulir pengaturan).
 * Tanpa itu ketiganya akan punya tafsir sendiri-sendiri atas isi JSONB yang sama.
 */

// ---------------------------------------------------------------------------
// Google Sheets
// ---------------------------------------------------------------------------

/**
 * Kolom metadata yang selalu bisa ikut ditulis ke sheet, di luar jawaban field.
 * Urutannya di sini adalah urutan kolomnya di spreadsheet.
 */
export const SHEET_META_COLUMNS = [
  { key: 'submittedAt', label: 'Waktu Submit' },
  { key: 'submissionId', label: 'ID Submission' },
  { key: 'versionNumber', label: 'Versi Form' },
] as const;

export type SheetMetaColumnKey = (typeof SHEET_META_COLUMNS)[number]['key'];

export const googleSheetConfigSchema = z.object({
  /** ID spreadsheet, bukan URL penuh — pakai `extractSpreadsheetId` untuk menormalkan. */
  spreadsheetId: z.string().trim().min(1, 'ID spreadsheet wajib diisi').max(200),
  /** Nama tab di dalam spreadsheet. Harus sudah ada; worker tidak membuat tab baru. */
  sheetName: z.string().trim().min(1, 'Nama sheet wajib diisi').max(100).prefault('Sheet1'),
  /**
   * Field mana yang ditulis dan dalam urutan apa. Array kosong = semua field yang
   * menghasilkan jawaban, mengikuti urutan di form. Menyimpan daftar eksplisit
   * membuat kolom di spreadsheet tidak bergeser saat field baru ditambahkan
   * di tengah form.
   */
  fieldIds: z.array(z.string().min(1)).max(200).prefault([]),
  /** Kolom metadata yang ikut ditulis, ditaruh di depan kolom jawaban. */
  metaColumns: z
    .array(z.enum(SHEET_META_COLUMNS.map((column) => column.key) as [SheetMetaColumnKey]))
    .prefault(['submittedAt']),
  /** Tulis baris header otomatis kalau sheet-nya masih benar-benar kosong. */
  writeHeader: z.boolean().prefault(true),
  /**
   * Referensi kredensial, bukan kredensialnya sendiri (lihat catatan desain Part 1).
   * Sekarang hanya ada satu service account dari environment variable; kolom ini
   * ada supaya beberapa kredensial bisa ditambahkan tanpa mengubah bentuk data.
   */
  credentialRef: z.string().trim().min(1).max(64).prefault('default'),
});
export type GoogleSheetConfig = z.infer<typeof googleSheetConfigSchema>;

const SPREADSHEET_URL_PATTERN = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;

/**
 * Menerima ID mentah maupun URL lengkap yang di-copy dari address bar browser.
 * Orang hampir selalu menempelkan URL, jadi memaksa mereka memotong sendiri
 * bagian ID-nya cuma menciptakan kesalahan yang bisa dihindari.
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();

  return SPREADSHEET_URL_PATTERN.exec(trimmed)?.[1] ?? trimmed;
}

export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}

/**
 * Daftar field yang ditulis ke sheet, sudah dipetakan ke schema.
 * `fieldIds` yang menunjuk field tidak dikenal (misal field yang sudah dihapus
 * dari form) dilewati — kolomnya hilang, tapi sync-nya tidak ikut gagal.
 */
export function resolveSheetFields(schema: FormSchema, config: GoogleSheetConfig) {
  const inputFields = getInputFields(schema);

  if (config.fieldIds.length === 0) return inputFields;

  const byId = new Map(inputFields.map((field) => [field.id, field]));

  return config.fieldIds.flatMap((id) => {
    const field = byId.get(id);

    return field ? [field] : [];
  });
}

// ---------------------------------------------------------------------------
// Notifikasi email
// ---------------------------------------------------------------------------

/**
 * Template email bawaan. Disimpan sebagai daftar tertutup, bukan HTML bebas dari
 * database: isi email dirender di worker dan dikirim ke luar, jadi membiarkan
 * markup sembarangan masuk ke sana berarti membuka jalur injeksi yang tidak
 * perlu ada.
 */
export const EMAIL_TEMPLATES = [
  {
    id: 'submission_summary',
    name: 'Ringkasan jawaban',
    description: 'Seluruh jawaban ditampilkan sebagai tabel label–jawaban.',
  },
  {
    id: 'submission_alert',
    name: 'Pemberitahuan singkat',
    description: 'Hanya memberitahu ada submission baru, tanpa memuat isi jawaban.',
  },
] as const;

export type EmailTemplateId = (typeof EMAIL_TEMPLATES)[number]['id'];

export const emailTemplateIdSchema = z.enum(
  EMAIL_TEMPLATES.map((template) => template.id) as [EmailTemplateId, ...EmailTemplateId[]],
);

export const DEFAULT_EMAIL_TEMPLATE_ID: EmailTemplateId = 'submission_summary';

/** Subjek bawaan; token `{{form}}` diisi judul form saat dirender. */
export const DEFAULT_EMAIL_SUBJECT = 'Submission baru: {{form}}';

/**
 * Aturan penerima dinamis: kalau jawaban cocok, penerima ini ikut ditambahkan.
 * Bentuknya sengaja sama dengan `ConditionRule` supaya condition builder yang
 * sudah ada di form builder bisa dipakai ulang tanpa komponen kedua.
 */
export const recipientRuleSchema = z.object({
  condition: conditionGroupSchema,
  recipients: z.array(z.email('Format email tidak valid')).min(1).max(50),
});
export type RecipientRule = z.infer<typeof recipientRuleSchema>;

/** Isi kolom JSONB `notification_rules.recipient_rules`. */
export const recipientRulesSchema = z.object({
  rules: z.array(recipientRuleSchema).max(20).prefault([]),
});
export type RecipientRules = z.infer<typeof recipientRulesSchema>;

export const notificationTriggerSchema = z.enum(['on_submit']);
export type NotificationTrigger = z.infer<typeof notificationTriggerSchema>;

// ---------------------------------------------------------------------------
// Penerima
// ---------------------------------------------------------------------------

export interface ResolveRecipientsInput {
  /** Daftar email tetap dari kolom `recipients`. */
  recipients: readonly string[];
  /** Field bertipe email yang jawabannya ikut dijadikan tujuan (auto-reply ke pengisi). */
  recipientFieldIds: readonly string[];
  /** Tujuan bersyarat dari kolom `recipient_rules`. */
  recipientRules: RecipientRules | null;
}

/**
 * Menggabungkan tiga sumber penerima menjadi satu daftar unik.
 *
 * Urutan sumbernya tidak berpengaruh karena hasilnya diurutkan; yang penting
 * hasilnya deterministik, supaya dua job untuk submission yang sama menghasilkan
 * daftar penerima yang persis sama dan idempotency-nya tetap berlaku.
 */
export function resolveRecipients(
  input: ResolveRecipientsInput,
  schema: FormSchema,
  answers: AnswerMap,
): string[] {
  const collected = new Set<string>();

  for (const email of input.recipients) {
    add(collected, email);
  }

  for (const fieldId of input.recipientFieldIds) {
    const answer = answers[fieldId];

    if (typeof answer === 'string') add(collected, answer);
    else if (Array.isArray(answer)) for (const item of answer) add(collected, item);
  }

  for (const rule of input.recipientRules?.rules ?? []) {
    if (!matchesConditionGroup(rule.condition, schema, answers)) continue;

    for (const email of rule.recipients) add(collected, email);
  }

  return [...collected].sort();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Penerima dinamis datang dari jawaban orang luar, jadi nilai yang bukan email
 * dibuang diam-diam. Menggagalkan seluruh job hanya karena satu isian ngawur
 * berarti penerima yang sah ikut tidak dapat kabar.
 */
function add(target: Set<string>, value: string): void {
  const email = value.trim().toLowerCase();

  if (EMAIL_PATTERN.test(email)) target.add(email);
}

/** Apakah notifikasi ini jadi dikirim untuk jawaban tersebut. */
export function shouldNotify(
  condition: ConditionGroup | null | undefined,
  schema: FormSchema,
  answers: AnswerMap,
): boolean {
  if (!condition) return true;

  return matchesConditionGroup(condition, schema, answers);
}

// ---------------------------------------------------------------------------
// Template teks
// ---------------------------------------------------------------------------

const TOKEN_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Mengganti token `{{nama}}` dengan nilai dari `variables`.
 *
 * Token yang tidak dikenal dibiarkan apa adanya, bukan dikosongkan — subjek yang
 * tiba-tiba kehilangan sepotong teks jauh lebih sulit ditelusuri daripada subjek
 * yang jelas-jelas masih memuat `{{typo}}`.
 */
export function renderTemplateString(template: string, variables: Record<string, string>): string {
  return template.replace(TOKEN_PATTERN, (match, token: string) => variables[token] ?? match);
}

// ---------------------------------------------------------------------------
// Hasil job (dikembalikan worker, dibaca API untuk fitur "Test Kirim")
// ---------------------------------------------------------------------------

export interface SheetSyncResult {
  /** `skipped` berarti baris ini sudah pernah masuk — bukan kegagalan. */
  status: 'synced' | 'skipped';
  spreadsheetId: string;
  sheetName: string;
  /** Rentang sel hasil append, misal `Sheet1!A5:E5`. */
  updatedRange: string | null;
  columnCount: number;
}

export interface EmailDeliveryResult {
  recipient: string;
  status: 'sent' | 'skipped' | 'failed';
  messageId: string | null;
  error: string | null;
}

export interface EmailNotificationResult {
  subject: string;
  provider: string;
  deliveries: EmailDeliveryResult[];
}
