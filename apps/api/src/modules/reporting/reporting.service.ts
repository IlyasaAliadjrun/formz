import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  REPORT_VIEWS,
  buildFieldDistribution,
  createEmptyFormSchema,
  formSchemaSchema,
  hasDistribution,
  summarizeIntegration,
  type FormSchema,
  type ReportFieldDistribution,
  type ReportFreshness,
  type ReportIntegrationStat,
  type ReportOverview,
  type ReportTotals,
  type ReportTrendPoint,
} from '@formz/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { ReportOverviewDto } from './dto/reports.dto';

/**
 * Penyusun laporan per form.
 *
 * Seluruh angka di sini datang dari **materialized view**, bukan dari tabel
 * `submissions` langsung (ARCHITECTURE.md bagian 3.6). Alasannya distribusi
 * jawaban: menghitungnya berarti membongkar JSONB setiap submission dengan
 * `jsonb_each` + `jsonb_array_elements`, dan itu pekerjaan yang tidak boleh
 * dijalankan ulang setiap kali seseorang membuka halaman laporan sementara
 * form-nya sedang menerima kiriman.
 *
 * Harganya: angkanya selalu tertinggal sampai refresh berikutnya. Itu tidak
 * disembunyikan — `freshness` ikut dikirim ke layar, lengkap dengan berapa
 * submission yang masuk setelah perhitungan terakhir.
 *
 * Label field dan label opsi diambil dari schema versi **berlaku**, sama seperti
 * kolom di daftar submission. Konsekuensinya sama pula: field yang sudah dihapus
 * dari form tidak lagi punya chart, sementara id opsi lama yang masih tersimpan
 * di jawaban tetap muncul dengan tanda `orphan`.
 */

/** Kolom hasil query agregasi. Sengaja di-cast ke `int` di SQL, bukan `bigint`. */
interface TotalsRow {
  total: number;
  first_at: Date | null;
  last_at: Date | null;
  active_days: number;
}

interface TrendRow {
  bucket: string;
  count: number;
}

interface IntegrationRow {
  kind: string;
  status: string;
  count: number;
}

interface OptionRow {
  field_id: string;
  option_id: string;
  count: number;
}

interface FieldRow {
  field_id: string;
  count: number;
}

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async overview(query: ReportOverviewDto): Promise<ReportOverview> {
    const form = await this.requireForm(query.formId);
    const from = query.from ?? null;
    const to = query.to ?? null;

    const [schema, totalsRows, trendRows, integrationRows, optionRows, fieldRows, refreshRows] =
      await Promise.all([
        this.resolveSchema(query.formId),
        this.prisma.$queryRaw<TotalsRow[]>`
          SELECT coalesce(sum(submission_count), 0)::int AS total,
                 min(first_at)                           AS first_at,
                 max(last_at)                            AS last_at,
                 count(*)::int                           AS active_days
            FROM report_submission_daily
           WHERE form_id = ${query.formId}::uuid
             AND (${from}::date IS NULL OR bucket >= ${from}::date)
             AND (${to}::date IS NULL OR bucket <= ${to}::date)
        `,
        this.prisma.$queryRaw<TrendRow[]>`
          SELECT to_char(date_trunc(${query.granularity}::text, bucket::timestamp), 'YYYY-MM-DD')
                     AS bucket,
                 sum(submission_count)::int AS count
            FROM report_submission_daily
           WHERE form_id = ${query.formId}::uuid
             AND (${from}::date IS NULL OR bucket >= ${from}::date)
             AND (${to}::date IS NULL OR bucket <= ${to}::date)
           GROUP BY 1
           ORDER BY 1
        `,
        this.prisma.$queryRaw<IntegrationRow[]>`
          SELECT type::text            AS kind,
                 status::text          AS status,
                 sum(log_count)::int   AS count
            FROM report_integration_daily
           WHERE form_id = ${query.formId}::uuid
             AND (${from}::date IS NULL OR bucket >= ${from}::date)
             AND (${to}::date IS NULL OR bucket <= ${to}::date)
           GROUP BY 1, 2
        `,
        this.prisma.$queryRaw<OptionRow[]>`
          SELECT field_id,
                 option_id,
                 sum(answer_count)::int AS count
            FROM report_answer_option_daily
           WHERE form_id = ${query.formId}::uuid
             AND (${from}::date IS NULL OR bucket >= ${from}::date)
             AND (${to}::date IS NULL OR bucket <= ${to}::date)
           GROUP BY 1, 2
        `,
        this.prisma.$queryRaw<FieldRow[]>`
          SELECT field_id,
                 sum(respondent_count)::int AS count
            FROM report_answer_field_daily
           WHERE form_id = ${query.formId}::uuid
             AND (${from}::date IS NULL OR bucket >= ${from}::date)
             AND (${to}::date IS NULL OR bucket <= ${to}::date)
           GROUP BY 1
        `,
        this.prisma.reportRefreshState.findMany({
          select: { viewName: true, refreshedAt: true, errorMessage: true },
        }),
      ]);

    const totals = buildTotals(totalsRows[0]);

    return {
      form: { id: form.id, title: form.title, status: form.status },
      range: { from, to, granularity: query.granularity },
      totals,
      trend: trendRows.map((row): ReportTrendPoint => ({ bucket: row.bucket, count: row.count })),
      integrations: {
        sheet: statOf('sheet', integrationRows),
        email: statOf('email', integrationRows),
      },
      distributions: buildDistributions(schema, optionRows, fieldRows, totals.submissions),
      freshness: await this.buildFreshness(query, refreshRows),
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
   * Bentuk form yang sedang berlaku — versi terpublish terakhir, atau versi apa
   * pun yang terakhir kalau form-nya belum pernah dipublish. Aturannya sengaja
   * sama persis dengan penentuan kolom di daftar submission.
   */
  private async resolveSchema(formId: string): Promise<FormSchema> {
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

    if (!version) return createEmptyFormSchema('Form tanpa versi');

    const parsed = formSchemaSchema.safeParse(version.schema);

    return parsed.success ? parsed.data : createEmptyFormSchema('Versi tidak terbaca');
  }

  /**
   * Kapan angka-angka ini dihitung, dan berapa yang belum ikut terhitung.
   *
   * Yang diambil waktu refresh **paling tua** di antara keempat view: satu view
   * yang tertinggal sudah cukup membuat sebagian angka di layar tidak sinkron
   * dengan yang lain, dan melaporkan yang paling baru akan menutupi persis
   * keadaan itu.
   */
  private async buildFreshness(
    query: ReportOverviewDto,
    rows: Array<{ viewName: string; refreshedAt: Date | null; errorMessage: string | null }>,
  ): Promise<ReportFreshness> {
    const known = new Map(rows.map((row) => [row.viewName, row]));
    const timestamps: Array<Date | null> = REPORT_VIEWS.map(
      (view) => known.get(view)?.refreshedAt ?? null,
    );

    // View yang belum pernah tercatat sama sekali berarti refresh pertama belum
    // pernah jalan — laporannya baru berisi data hasil `CREATE MATERIALIZED VIEW`.
    const refreshedAt = timestamps.some((value) => value === null)
      ? null
      : new Date(Math.min(...timestamps.map((value) => (value as Date).getTime())));

    const errorMessage =
      REPORT_VIEWS.map((view) => known.get(view)?.errorMessage).find(Boolean) ?? null;

    return {
      refreshedAt: refreshedAt?.toISOString() ?? null,
      pendingSubmissions: await this.countPending(query, refreshedAt),
      errorMessage,
    };
  }

  /** Submission dalam rentang laporan yang masuk setelah refresh terakhir. */
  private countPending(query: ReportOverviewDto, refreshedAt: Date | null): Promise<number> {
    const range: Prisma.DateTimeFilter = {};

    if (query.from) range.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) range.lte = new Date(`${query.to}T23:59:59.999Z`);

    return this.prisma.submission.count({
      where: {
        formId: query.formId,
        AND: [
          // Belum pernah di-refresh: semua yang ada di rentang ini belum terhitung.
          { submittedAt: refreshedAt ? { gt: refreshedAt } : {} },
          { submittedAt: range },
        ],
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Pemetaan hasil query
// ---------------------------------------------------------------------------

function buildTotals(row: TotalsRow | undefined): ReportTotals {
  const submissions = row?.total ?? 0;
  const activeDays = row?.active_days ?? 0;

  return {
    submissions,
    firstSubmissionAt: row?.first_at?.toISOString() ?? null,
    lastSubmissionAt: row?.last_at?.toISOString() ?? null,
    activeDays,
    // Per hari **aktif**, bukan per hari kalender: form yang dibuka dua hari
    // dalam sebulan tidak sedang menerima 0,5 kiriman per hari, dan membaginya
    // dengan panjang rentang hanya menghasilkan angka yang tidak berarti apa-apa.
    averagePerActiveDay: activeDays === 0 ? 0 : Math.round((submissions / activeDays) * 10) / 10,
  };
}

function statOf(kind: 'sheet' | 'email', rows: IntegrationRow[]): ReportIntegrationStat {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    if (row.kind !== kind) continue;

    counts[row.status] = (counts[row.status] ?? 0) + row.count;
  }

  return summarizeIntegration(kind, counts);
}

/**
 * Satu distribusi per field bertipe pilihan, dalam urutan field di form.
 *
 * Field yang belum punya satu jawaban pun tetap ikut — chart kosong berisi nol
 * lebih jujur daripada field yang menghilang tanpa keterangan, dan itu juga
 * yang membedakan "belum ada yang menjawab" dari "field-nya sudah dihapus".
 */
function buildDistributions(
  schema: FormSchema,
  optionRows: OptionRow[],
  fieldRows: FieldRow[],
  totalSubmissions: number,
): ReportFieldDistribution[] {
  const countsByField = new Map<string, Map<string, number>>();

  for (const row of optionRows) {
    const bucket = countsByField.get(row.field_id) ?? new Map<string, number>();

    bucket.set(row.option_id, (bucket.get(row.option_id) ?? 0) + row.count);
    countsByField.set(row.field_id, bucket);
  }

  const respondents = new Map(fieldRows.map((row) => [row.field_id, row.count]));
  const distributions: ReportFieldDistribution[] = [];

  for (const field of schema.fields) {
    if (!hasDistribution(field.type)) continue;

    const distribution = buildFieldDistribution(
      field,
      countsByField.get(field.id) ?? new Map<string, number>(),
      respondents.get(field.id) ?? 0,
      totalSubmissions,
    );

    if (distribution) distributions.push(distribution);
  }

  return distributions;
}
