import {
  SHEET_META_COLUMNS,
  formatAnswerValue,
  googleSheetConfigSchema,
  resolveSheetFields,
  sheetSyncJobSchema,
  type GoogleSheetConfig,
  type SheetMetaColumnKey,
  type SheetSyncJob,
  type SheetSyncResult,
} from '@formz/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  beginLog,
  loadFormContext,
  loadIntegration,
  loadSubmissionContext,
  markLogFailed,
  markLogSuccess,
  type SubmissionContext,
} from '../db/queries';
import {
  appendRows,
  describeGoogleError,
  hasHeaderRow,
  isRetryableGoogleError,
  sheetsClient,
} from '../google/sheets';
import { createLogger } from '../logger';
import { buildSampleSubmission } from '../sample-submission';

const logger = createLogger('sheet-sync');

/**
 * Menyalin satu submission menjadi satu baris di Google Sheets.
 *
 * Tiga hal yang menentukan bentuk kode di bawah:
 *
 * 1. **Idempotent.** `beginLog` memeriksa dan menandai dalam satu pernyataan SQL
 *    atomik; kalau baris untuk (submission, integrasi) ini sudah berstatus
 *    success, fungsi itu mengembalikan null dan job selesai tanpa menulis apa
 *    pun. Inilah yang membuat retry — otomatis maupun manual — tidak
 *    menggandakan baris di spreadsheet (ARCHITECTURE.md bagian 6 poin 3).
 * 2. **Retry hanya untuk kegagalan yang bisa pulih.** Kuota dan gangguan
 *    jaringan diulang dengan exponential backoff; spreadsheet yang belum
 *    dibagikan ke service account tidak.
 * 3. **Setiap perubahan status tercatat.** Halaman detail submission membaca
 *    tabel yang sama, jadi "sudah masuk / belum / gagal" di layar adalah catatan
 *    yang ditulis di sini, bukan tebakan.
 */
export async function processSheetSync(job: Job<SheetSyncJob>): Promise<SheetSyncResult> {
  const payload = sheetSyncJobSchema.parse(job.data);
  const integration = await loadIntegration(payload.integrationId);

  if (!integration) {
    // Integrasinya dihapus setelah job diantre. Tidak ada yang bisa diperbaiki
    // dengan mengulang, dan tidak ada yang salah — targetnya memang tidak ada lagi.
    throw new UnrecoverableError(`Integrasi ${payload.integrationId} sudah tidak ada`);
  }

  if (!integration.isActive) {
    throw new UnrecoverableError(`Integrasi ${payload.integrationId} sedang dinonaktifkan`);
  }

  const parsedConfig = googleSheetConfigSchema.safeParse(integration.config);

  if (!parsedConfig.success) {
    throw new UnrecoverableError(
      `Konfigurasi integrasi ${payload.integrationId} tidak valid: ${parsedConfig.error.message}`,
    );
  }

  const config = parsedConfig.data;
  const context = await resolveContext(payload);

  // Uji coba tidak menyentuh submission_integration_logs sama sekali: tabel itu
  // catatan tentang submission sungguhan, dan mengisinya dengan hasil percobaan
  // membuat riwayat integrasi tidak lagi bisa dipercaya.
  const log =
    payload.mode === 'live' ? await beginLog(context.submissionId, 'sheet', integration.id) : null;

  if (payload.mode === 'live' && !log) {
    logger.info(
      `Submission ${context.submissionId} sudah pernah masuk sheet lewat integrasi ${integration.id} — dilewati`,
    );

    return {
      status: 'skipped',
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      updatedRange: null,
      columnCount: 0,
    };
  }

  try {
    const sheets = sheetsClient();
    const header = buildHeader(context, config);
    const row = buildRow(context, config);
    const rows: string[][] = [];

    // Header hanya ditulis kalau tab-nya benar-benar masih kosong. Menulisnya
    // tanpa pemeriksaan berarti menyisipkan baris judul di tengah data yang
    // sudah ada setiap kali worker restart.
    if (
      config.writeHeader &&
      !(await hasHeaderRow(sheets, config.spreadsheetId, config.sheetName))
    ) {
      rows.push(header);
    }

    rows.push(row);

    const { updatedRange } = await appendRows(sheets, config.spreadsheetId, config.sheetName, rows);

    if (log) await markLogSuccess(log.id);

    logger.info(
      `Submission ${context.submissionId} → ${config.spreadsheetId}/${config.sheetName}` +
        (updatedRange ? ` (${updatedRange})` : ''),
    );

    return {
      status: 'synced',
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      updatedRange,
      columnCount: row.length,
    };
  } catch (error) {
    const message = describeGoogleError(error);

    if (log) await markLogFailed(log.id, message);

    logger.error(
      `Gagal menulis submission ${context.submissionId} ke ${config.spreadsheetId}: ${message}`,
    );

    if (!isRetryableGoogleError(error)) throw new UnrecoverableError(message);

    // Dilempar apa adanya supaya BullMQ mengulang sesuai backoff-nya.
    throw error instanceof Error ? error : new Error(message);
  }
}

async function resolveContext(payload: SheetSyncJob): Promise<SubmissionContext> {
  if (payload.mode === 'test' || !payload.submissionId) {
    const form = await loadFormContext(payload.formId);

    if (!form) throw new UnrecoverableError(`Form ${payload.formId} belum punya versi schema`);

    return buildSampleSubmission(form, new Date());
  }

  const context = await loadSubmissionContext(payload.submissionId);

  if (!context) {
    throw new UnrecoverableError(`Submission ${payload.submissionId} sudah tidak ada`);
  }

  return context;
}

// ---------------------------------------------------------------------------
// Menyusun baris
// ---------------------------------------------------------------------------

function buildHeader(context: SubmissionContext, config: GoogleSheetConfig): string[] {
  return [
    ...config.metaColumns.map((key) => metaLabel(key)),
    ...resolveSheetFields(context.schema, config).map((field) => field.label),
  ];
}

/**
 * Isi selnya memakai `formatAnswerValue` dari @formz/shared — fungsi yang sama
 * dengan yang dipakai halaman detail submission dan berkas ekspor. Jadi label
 * opsi di spreadsheet tidak mungkin berbeda dari yang terlihat di dashboard,
 * termasuk ketika submission-nya memakai versi form yang sudah lama.
 */
function buildRow(context: SubmissionContext, config: GoogleSheetConfig): string[] {
  return [
    ...config.metaColumns.map((key) => metaValue(key, context)),
    ...resolveSheetFields(context.schema, config).map((field) =>
      formatAnswerValue(field, context.answers[field.id]),
    ),
  ];
}

function metaLabel(key: SheetMetaColumnKey): string {
  return SHEET_META_COLUMNS.find((column) => column.key === key)?.label ?? key;
}

function metaValue(key: SheetMetaColumnKey, context: SubmissionContext): string {
  switch (key) {
    case 'submittedAt':
      return formatTimestamp(context.submittedAt);
    case 'submissionId':
      return context.submissionId;
    case 'versionNumber':
      return `v${context.versionNumber}`;
  }
}

/**
 * `YYYY-MM-DD HH:mm:ss` dalam zona waktu proses (TZ di compose). Format ISO
 * lengkap dengan `T` dan `Z` tidak dikenali Google Sheets sebagai tanggal, jadi
 * selnya akan tersimpan sebagai teks dan tidak bisa diurutkan.
 */
function formatTimestamp(value: Date): string {
  const pad = (input: number) => String(input).padStart(2, '0');

  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}
