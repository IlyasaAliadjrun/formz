import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  createEmptyFormSchema,
  describeAnswers,
  formSchemaSchema,
  type AnswerEntry,
  type AnswerMap,
  type FormSchema,
} from '@formz/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { ExportSubmissionsDto, ListSubmissionsDto } from './dto/submissions.dto';

/**
 * Pembacaan submission untuk dashboard admin.
 *
 * Aturan yang mengatur seluruh berkas ini: **jawaban selalu diterjemahkan dengan
 * schema versi submission itu sendiri**, bukan versi form terbaru
 * (ARCHITECTURE.md bagian 6 poin 1). Kalau sebuah opsi dihapus atau label field
 * diubah setelah orang mengisi form, tampilan histori tetap menunjukkan apa yang
 * mereka lihat saat mengisi — bukan tafsir baru atas data lama.
 */

export interface SubmissionColumn {
  fieldId: string;
  name: string;
  label: string;
  type: string;
}

/** Ringkasan status integrasi untuk satu submission, dipakai di kolom daftar. */
export interface IntegrationSummary {
  sheet: string | null;
  email: string | null;
}

export interface SubmissionRow {
  id: string;
  submittedAt: Date;
  formVersionId: string;
  versionNumber: number;
  sourceDomain: string | null;
  /** Teks siap tampil per kolom, dikunci dengan field id. */
  values: Record<string, string>;
  integrations: IntegrationSummary;
}

export interface SubmissionListResult {
  data: SubmissionRow[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
  /** Kolom yang tersedia, diambil dari versi terpublish terakhir. */
  columns: SubmissionColumn[];
  form: { id: string; title: string; status: string };
}

export interface SheetIntegrationStatus {
  integrationId: string;
  spreadsheetId: string | null;
  sheetName: string | null;
  /** Link langsung ke spreadsheet-nya, null kalau config belum lengkap. */
  url: string | null;
  status: 'success' | 'failed' | 'pending';
  retryCount: number;
  errorMessage: string | null;
  syncedAt: Date | null;
}

export interface EmailRecipientStatus {
  target: string;
  status: 'success' | 'failed' | 'pending';
  retryCount: number;
  errorMessage: string | null;
  syncedAt: Date | null;
}

export interface SubmissionIntegrations {
  sheet: { configured: boolean; targets: SheetIntegrationStatus[] };
  email: {
    configured: boolean;
    /** Penerima menurut konfigurasi, dipakai selama job belum berjalan. */
    expectedRecipients: string[];
    recipients: EmailRecipientStatus[];
  };
}

export interface SubmissionDetail {
  id: string;
  submittedAt: Date;
  ipAddress: string | null;
  sourceDomain: string | null;
  form: { id: string; title: string; formKey: string; status: string };
  version: { id: string; versionNumber: number; publishedAt: Date | null; isLatest: boolean };
  entries: AnswerEntry[];
  integrations: SubmissionIntegrations;
}

/**
 * Batas baris ekspor. Angka ini ada supaya satu klik tidak bisa membuat API
 * menyusun ratusan megabyte di memori; kalau nanti perlu lebih, ekspornya harus
 * jadi job antrean yang mengirim tautan unduhan, bukan sekadar dinaikkan.
 */
const EXPORT_ROW_LIMIT = 20_000;

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListSubmissionsDto): Promise<SubmissionListResult> {
    const form = await this.requireForm(query.formId);
    const where = buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.submission.findMany({
        where,
        select: SUBMISSION_ROW_SELECT,
        orderBy: { submittedAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.submission.count({ where }),
    ]);

    const schemas = await this.loadSchemas(rows.map((row) => row.formVersionId));
    const columns = await this.resolveColumns(query.formId);

    return {
      data: rows.map((row) => this.toRow(row, schemas)),
      meta: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      },
      columns,
      form: { id: form.id, title: form.title, status: form.status },
    };
  }

  async findById(id: string): Promise<SubmissionDetail> {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      select: {
        id: true,
        answers: true,
        submittedAt: true,
        ipAddress: true,
        sourceDomain: true,
        form: {
          select: {
            id: true,
            title: true,
            formKey: true,
            status: true,
            integrations: {
              where: { isActive: true },
              select: { id: true, type: true, config: true },
            },
            notificationRules: {
              where: { isActive: true },
              select: { recipients: true },
            },
            versions: {
              orderBy: { versionNumber: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        },
        formVersion: {
          select: { id: true, versionNumber: true, publishedAt: true, schema: true },
        },
        integrationLogs: {
          select: {
            type: true,
            status: true,
            target: true,
            retryCount: true,
            errorMessage: true,
            syncedAt: true,
          },
        },
      },
    });

    if (!submission) throw new NotFoundException(`Submission ${id} tidak ditemukan`);

    const schema = parseSchema(submission.formVersion.schema);
    const answers = toAnswerMap(submission.answers);

    return {
      id: submission.id,
      submittedAt: submission.submittedAt,
      ipAddress: submission.ipAddress,
      sourceDomain: submission.sourceDomain,
      form: {
        id: submission.form.id,
        title: submission.form.title,
        formKey: submission.form.formKey,
        status: submission.form.status,
      },
      version: {
        id: submission.formVersion.id,
        versionNumber: submission.formVersion.versionNumber,
        publishedAt: submission.formVersion.publishedAt,
        // Penanda untuk UI: kalau bukan versi terbaru, tampilan ini sengaja
        // memakai schema lama dan memang boleh berbeda dari form sekarang.
        isLatest: submission.form.versions[0]?.id === submission.formVersion.id,
      },
      entries: describeAnswers(schema, answers),
      integrations: buildIntegrations(
        submission.form.integrations,
        submission.form.notificationRules,
        submission.integrationLogs,
      ),
    };
  }

  /**
   * Data mentah untuk ekspor: kolom gabungan dari semua versi yang muncul di
   * hasil filter, plus satu baris per submission.
   */
  async collectForExport(query: ExportSubmissionsDto): Promise<{
    form: { id: string; title: string };
    columns: SubmissionColumn[];
    rows: Array<{
      id: string;
      submittedAt: Date;
      versionNumber: number;
      sourceDomain: string | null;
      values: Record<string, string>;
    }>;
    truncated: boolean;
    total: number;
  }> {
    const form = await this.requireForm(query.formId);
    const where = buildWhere(query);

    const total = await this.prisma.submission.count({ where });
    const rows = await this.prisma.submission.findMany({
      where,
      select: {
        id: true,
        answers: true,
        submittedAt: true,
        sourceDomain: true,
        formVersionId: true,
        formVersion: { select: { versionNumber: true } },
      },
      // Menaik: ekspor terbaca seperti catatan kronologis, bukan terbalik.
      orderBy: { submittedAt: 'asc' },
      take: EXPORT_ROW_LIMIT,
    });

    const schemas = await this.loadSchemas(rows.map((row) => row.formVersionId));

    return {
      form: { id: form.id, title: form.title },
      columns: mergeColumns(await this.resolveColumns(query.formId), schemas),
      rows: rows.map((row) => ({
        id: row.id,
        submittedAt: row.submittedAt,
        versionNumber: row.formVersion.versionNumber,
        sourceDomain: row.sourceDomain,
        values: renderValues(schemas.get(row.formVersionId), row.answers),
      })),
      truncated: total > rows.length,
      total,
    };
  }

  // -------------------------------------------------------------------------
  // Helper
  // -------------------------------------------------------------------------

  private async requireForm(formId: string) {
    const form = await this.prisma.form.findUnique({
      where: { id: formId },
      select: { id: true, title: true, status: true },
    });

    if (!form) throw new NotFoundException(`Form ${formId} tidak ditemukan`);

    return form;
  }

  /**
   * Kolom daftar diambil dari versi **terpublish** terakhir — itulah bentuk form
   * yang sedang berlaku. Kalau form belum pernah dipublish (baru draft), versi
   * terakhir apa pun dipakai supaya tabelnya tidak kosong melompong.
   */
  private async resolveColumns(formId: string): Promise<SubmissionColumn[]> {
    const version =
      (await this.prisma.formVersion.findFirst({
        where: { formId, publishedAt: { not: null } },
        orderBy: { versionNumber: 'desc' },
        select: { schema: true },
      })) ??
      (await this.prisma.formVersion.findFirst({
        where: { formId },
        orderBy: { versionNumber: 'desc' },
        select: { schema: true },
      }));

    return version ? toColumns(parseSchema(version.schema)) : [];
  }

  /**
   * Memuat schema untuk sekumpulan versi sekali jalan. Satu halaman submission
   * biasanya hanya menyentuh satu-dua versi, jadi memuatnya terpisah jauh lebih
   * hemat daripada ikut menempel di tiap baris hasil query.
   */
  private async loadSchemas(versionIds: string[]): Promise<Map<string, FormSchema>> {
    const unique = [...new Set(versionIds)];

    if (unique.length === 0) return new Map();

    const versions = await this.prisma.formVersion.findMany({
      where: { id: { in: unique } },
      select: { id: true, versionNumber: true, schema: true },
      orderBy: { versionNumber: 'desc' },
    });

    return new Map(versions.map((version) => [version.id, parseSchema(version.schema)]));
  }

  private toRow(row: SubmissionRowSelect, schemas: Map<string, FormSchema>): SubmissionRow {
    return {
      id: row.id,
      submittedAt: row.submittedAt,
      formVersionId: row.formVersionId,
      versionNumber: row.formVersion.versionNumber,
      sourceDomain: row.sourceDomain,
      values: renderValues(schemas.get(row.formVersionId), row.answers),
      integrations: summarizeLogs(row.integrationLogs),
    };
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const SUBMISSION_ROW_SELECT = {
  id: true,
  answers: true,
  submittedAt: true,
  sourceDomain: true,
  formVersionId: true,
  formVersion: { select: { versionNumber: true } },
  integrationLogs: { select: { type: true, status: true } },
} as const;

type SubmissionRowSelect = {
  id: string;
  answers: Prisma.JsonValue;
  submittedAt: Date;
  sourceDomain: string | null;
  formVersionId: string;
  formVersion: { versionNumber: number };
  integrationLogs: Array<{ type: string; status: string }>;
};

function buildWhere(query: {
  formId: string;
  from?: string;
  to?: string;
}): Prisma.SubmissionWhereInput {
  const submittedAt: Prisma.DateTimeFilter = {};

  if (query.from) submittedAt.gte = startOfRange(query.from);
  if (query.to) submittedAt.lte = endOfRange(query.to);

  return {
    formId: query.formId,
    ...(query.from || query.to ? { submittedAt } : {}),
  };
}

/** `2026-08-09` berarti sejak tengah malam; ISO lengkap dipakai apa adanya. */
function startOfRange(value: string): Date {
  return isDateOnly(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
}

/** `2026-08-09` berarti sampai detik terakhir hari itu, bukan tengah malamnya. */
function endOfRange(value: string): Date {
  return isDateOnly(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ---------------------------------------------------------------------------
// Pemetaan schema & jawaban
// ---------------------------------------------------------------------------

function toColumns(schema: FormSchema): SubmissionColumn[] {
  return schema.fields
    .filter((field) => field.type !== 'section_heading')
    .map((field) => ({
      fieldId: field.id,
      name: field.name,
      label: field.label,
      type: field.type,
    }));
}

/**
 * Menggabungkan kolom versi berlaku dengan field yang hanya ada di versi lama.
 *
 * Tanpa ini, ekspor yang mencakup submission lintas versi akan diam-diam
 * membuang jawaban untuk field yang sudah dihapus dari form — data yang benar
 * ada di database tapi tidak pernah muncul di berkas hasil ekspor.
 */
function mergeColumns(
  base: SubmissionColumn[],
  schemas: Map<string, FormSchema>,
): SubmissionColumn[] {
  const merged = [...base];
  const seen = new Set(base.map((column) => column.fieldId));

  for (const schema of schemas.values()) {
    for (const column of toColumns(schema)) {
      if (seen.has(column.fieldId)) continue;

      seen.add(column.fieldId);
      merged.push(column);
    }
  }

  return merged;
}

function renderValues(
  schema: FormSchema | undefined,
  answers: Prisma.JsonValue,
): Record<string, string> {
  const map = toAnswerMap(answers);

  if (!schema) {
    // Versinya tidak terbaca: tampilkan nilai mentah supaya datanya tidak hilang
    // dari layar hanya karena schema-nya bermasalah.
    return Object.fromEntries(
      Object.entries(map).map(([key, value]) => [key, String(value ?? '')]),
    );
  }

  return Object.fromEntries(
    describeAnswers(schema, map).map((entry) => [entry.fieldId, entry.display]),
  );
}

function parseSchema(value: Prisma.JsonValue): FormSchema {
  const parsed = formSchemaSchema.safeParse(value);

  return parsed.success ? parsed.data : createEmptyFormSchema('Versi tidak terbaca');
}

function toAnswerMap(value: Prisma.JsonValue): AnswerMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as AnswerMap)
    : {};
}

// ---------------------------------------------------------------------------
// Status integrasi
// ---------------------------------------------------------------------------

/** failed > pending > success: yang paling perlu ditindaklanjuti yang ditampilkan. */
function worstStatus(statuses: string[]): string | null {
  if (statuses.length === 0) return null;
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('pending')) return 'pending';

  return 'success';
}

function summarizeLogs(logs: Array<{ type: string; status: string }>): IntegrationSummary {
  return {
    sheet: worstStatus(logs.filter((log) => log.type === 'sheet').map((log) => log.status)),
    email: worstStatus(logs.filter((log) => log.type === 'email').map((log) => log.status)),
  };
}

interface LogRow {
  type: string;
  status: string;
  target: string | null;
  retryCount: number;
  errorMessage: string | null;
  syncedAt: Date | null;
}

/**
 * Menggabungkan **konfigurasi** (apa yang seharusnya terjadi) dengan **log**
 * (apa yang benar-benar terjadi).
 *
 * Keduanya diperlukan: sebelum job berjalan belum ada satu pun baris log, dan
 * tanpa membaca konfigurasi halaman detail akan terlihat seolah form ini memang
 * tidak punya integrasi — padahal jobnya cuma belum jalan.
 */
function buildIntegrations(
  integrations: Array<{ id: string; type: string; config: Prisma.JsonValue }>,
  notificationRules: Array<{ recipients: string[] }>,
  logs: LogRow[],
): SubmissionIntegrations {
  const sheetIntegrations = integrations.filter((item) => item.type === 'google_sheet');
  const sheetLogs = logs.filter((log) => log.type === 'sheet');
  const emailLogs = logs.filter((log) => log.type === 'email');

  const targets: SheetIntegrationStatus[] = sheetIntegrations.map((integration) => {
    const config = readSheetConfig(integration.config);
    // Log spreadsheet ditulis dengan target = spreadsheetId, jadi bisa dicocokkan
    // ke integrasinya kalau sebuah form punya lebih dari satu tujuan.
    const log =
      sheetLogs.find((item) => item.target === config.spreadsheetId) ??
      (sheetIntegrations.length === 1 ? sheetLogs[0] : undefined);

    return {
      integrationId: integration.id,
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      url: config.spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`
        : null,
      status: normalizeStatus(log?.status),
      retryCount: log?.retryCount ?? 0,
      errorMessage: log?.errorMessage ?? null,
      syncedAt: log?.syncedAt ?? null,
    };
  });

  const expectedRecipients = [
    ...new Set(notificationRules.flatMap((rule) => rule.recipients)),
  ].sort();

  const recipients: EmailRecipientStatus[] = emailLogs.map((log) => ({
    target: log.target ?? '(tanpa tujuan)',
    status: normalizeStatus(log.status),
    retryCount: log.retryCount,
    errorMessage: log.errorMessage,
    syncedAt: log.syncedAt,
  }));

  // Penerima yang dikonfigurasi tapi belum punya log ditampilkan sebagai pending.
  for (const email of expectedRecipients) {
    if (recipients.some((item) => item.target === email)) continue;

    recipients.push({
      target: email,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      syncedAt: null,
    });
  }

  return {
    sheet: { configured: sheetIntegrations.length > 0, targets },
    email: {
      configured: notificationRules.length > 0,
      expectedRecipients,
      recipients: recipients.sort((a, b) => a.target.localeCompare(b.target)),
    },
  };
}

function normalizeStatus(status: string | undefined): 'success' | 'failed' | 'pending' {
  return status === 'success' || status === 'failed' ? status : 'pending';
}

function readSheetConfig(config: Prisma.JsonValue): {
  spreadsheetId: string | null;
  sheetName: string | null;
} {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { spreadsheetId: null, sheetName: null };
  }

  const raw = config as Record<string, unknown>;

  return {
    spreadsheetId: typeof raw.spreadsheetId === 'string' ? raw.spreadsheetId : null,
    sheetName: typeof raw.sheetName === 'string' ? raw.sheetName : null,
  };
}
