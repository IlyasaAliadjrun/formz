import { z } from 'zod';
import type { FieldType } from './field-types';
import { hasOptions, optionValue, type FormField } from './form-schema';

/**
 * Bentuk data laporan — dipakai bersama oleh apps/api (yang menyusunnya),
 * apps/worker (yang me-refresh materialized view-nya), dan apps/dashboard
 * (yang menggambar chart-nya).
 *
 * Angka-angka di sini datang dari **materialized view**, bukan dari tabel
 * `submissions` langsung (ARCHITECTURE.md bagian 3.6). Konsekuensinya laporan
 * selalu tertinggal sampai refresh berikutnya, dan itu bukan detail yang boleh
 * disembunyikan: `ReportFreshness` ikut dikirim ke layar supaya pembacanya tahu
 * data yang dilihatnya per kapan.
 */

// ---------------------------------------------------------------------------
// Materialized view
// ---------------------------------------------------------------------------

/**
 * Nama materialized view laporan, dalam urutan refresh.
 *
 * Daftarnya ditaruh di sini karena dua service memakainya untuk hal berbeda:
 * worker menjalankan `REFRESH MATERIALIZED VIEW CONCURRENTLY` per nama, dan API
 * membaca waktu refresh terakhirnya dari `report_refresh_state`. Kalau masing-
 * masing punya daftar sendiri, view yang baru ditambahkan akan ter-refresh tapi
 * tidak pernah dilaporkan (atau sebaliknya).
 *
 * Nama-nama ini juga disisipkan langsung ke dalam SQL di worker — `REFRESH`
 * tidak menerima nama relasi sebagai parameter terikat. Karena itu daftarnya
 * wajib tetap berupa konstanta di berkas ini dan tidak boleh pernah berasal
 * dari input.
 */
export const REPORT_VIEWS = [
  'report_submission_daily',
  'report_integration_daily',
  'report_answer_field_daily',
  'report_answer_option_daily',
] as const;

export type ReportViewName = (typeof REPORT_VIEWS)[number];

// ---------------------------------------------------------------------------
// Parameter laporan
// ---------------------------------------------------------------------------

/**
 * Butir tren. Agregasi mentahnya selalu harian; mingguan disusun dari situ
 * dengan `date_trunc('week', …)`, jadi tidak perlu view kedua yang isinya
 * data yang sama dengan pengelompokan berbeda.
 */
export const REPORT_GRANULARITIES = ['day', 'week'] as const;
export const reportGranularitySchema = z.enum(REPORT_GRANULARITIES);
export type ReportGranularity = z.infer<typeof reportGranularitySchema>;

// ---------------------------------------------------------------------------
// Bentuk respons
// ---------------------------------------------------------------------------

export interface ReportTrendPoint {
  /** Awal periode dalam `YYYY-MM-DD` (UTC). Untuk minggu: hari Senin-nya. */
  bucket: string;
  count: number;
}

export type ReportIntegrationKind = 'sheet' | 'email';

export interface ReportIntegrationStat {
  kind: ReportIntegrationKind;
  /** Jumlah catatan yang ada — bukan jumlah submission. */
  total: number;
  success: number;
  failed: number;
  pending: number;
  /** Persentase sukses terhadap `total`. Null kalau belum ada catatan sama sekali. */
  successRate: number | null;
}

export interface ReportOptionShare {
  /** Id opsi apa adanya seperti tersimpan di jawaban. */
  optionId: string;
  label: string;
  count: number;
  /** Persentase terhadap `respondents` field ini, bukan terhadap total submission. */
  percentage: number;
  /** True kalau opsinya sudah tidak ada di schema versi berlaku. */
  orphan: boolean;
}

export interface ReportFieldDistribution {
  fieldId: string;
  label: string;
  type: FieldType;
  /**
   * Jumlah submission yang menjawab field ini di rentang tersebut — inilah
   * penyebut persentasenya. Untuk checkbox penyebutnya seluruh submission,
   * lihat `buildFieldDistribution`.
   */
  respondents: number;
  options: ReportOptionShare[];
}

export interface ReportFreshness {
  /** Waktu refresh materialized view paling tua di antara keempatnya. */
  refreshedAt: string | null;
  /** Submission yang masuk setelah refresh terakhir — belum terhitung di angka mana pun. */
  pendingSubmissions: number;
  /** Pesan kegagalan refresh terakhir, kalau ada. */
  errorMessage: string | null;
}

export interface ReportTotals {
  submissions: number;
  firstSubmissionAt: string | null;
  lastSubmissionAt: string | null;
  /** Jumlah hari yang benar-benar ada submission-nya di rentang ini. */
  activeDays: number;
  /** Rata-rata per hari aktif, bukan per hari kalender. */
  averagePerActiveDay: number;
}

export interface ReportOverview {
  form: { id: string; title: string; status: string };
  range: {
    from: string | null;
    to: string | null;
    granularity: ReportGranularity;
  };
  totals: ReportTotals;
  trend: ReportTrendPoint[];
  integrations: {
    sheet: ReportIntegrationStat;
    email: ReportIntegrationStat;
  };
  distributions: ReportFieldDistribution[];
  freshness: ReportFreshness;
}

// ---------------------------------------------------------------------------
// Perhitungan
// ---------------------------------------------------------------------------

/** Persentase dengan satu angka di belakang koma. 0 kalau penyebutnya nol. */
export function sharePercentage(count: number, total: number): number {
  if (total <= 0) return 0;

  return Math.round((count / total) * 1000) / 10;
}

/** Menyusun satu baris status integrasi dari cacah per status. */
export function summarizeIntegration(
  kind: ReportIntegrationKind,
  counts: { success?: number; failed?: number; pending?: number },
): ReportIntegrationStat {
  const success = counts.success ?? 0;
  const failed = counts.failed ?? 0;
  const pending = counts.pending ?? 0;
  const total = success + failed + pending;

  return {
    kind,
    total,
    success,
    failed,
    pending,
    // Null, bukan 0: "belum ada yang disinkronkan" dan "semua gagal" adalah dua
    // keadaan yang sangat berbeda, dan 0% menampilkan keduanya sama saja.
    successRate: total === 0 ? null : sharePercentage(success, total),
  };
}

/** Field type yang punya distribusi jawaban untuk digambar sebagai chart. */
export function hasDistribution(type: FieldType): boolean {
  return type === 'select' || type === 'multiselect' || type === 'radio' || type === 'checkbox';
}

/**
 * Menyusun distribusi jawaban satu field dari cacah per nilai.
 *
 * Dua hal yang membuat fungsi ini tidak sesepele kelihatannya:
 *
 * 1. **Checkbox tidak punya baris "tidak".** Renderer membuang nilai `false`
 *    dari payload, jadi kotak yang tidak dicentang tidak meninggalkan jejak apa
 *    pun di `answers`. Menghitung "Tidak" sebagai `respondents - Ya` akan selalu
 *    menghasilkan nol. Karena itu penyebut untuk checkbox adalah **seluruh
 *    submission** di rentang itu, dan "Tidak" adalah sisanya.
 * 2. **Opsi bisa dihapus dari schema.** Jawaban lama tetap menyimpan id opsi yang
 *    sudah tidak ada. Id seperti itu tetap ditampilkan (ditandai `orphan`) alih-
 *    alih dibuang, dengan alasan yang sama seperti di `describeAnswers`: data
 *    yang benar-benar ada tidak boleh hilang dari layar hanya karena form-nya
 *    sudah berubah.
 *
 * Mengembalikan null untuk field type yang memang tidak punya distribusi.
 */
export function buildFieldDistribution(
  field: FormField,
  /** Cacah per nilai tersimpan (id opsi, atau `"true"` untuk checkbox). */
  counts: ReadonlyMap<string, number>,
  /** Jumlah submission yang mengisi field ini. */
  respondents: number,
  /** Jumlah seluruh submission di rentang yang sama — penyebut untuk checkbox. */
  totalSubmissions: number,
): ReportFieldDistribution | null {
  if (!hasDistribution(field.type)) return null;

  if (field.type === 'checkbox') {
    const yes = counts.get('true') ?? 0;
    const no = Math.max(0, totalSubmissions - yes);

    return {
      fieldId: field.id,
      label: field.label,
      type: field.type,
      respondents: totalSubmissions,
      options: [
        {
          optionId: 'true',
          label: 'Ya',
          count: yes,
          percentage: sharePercentage(yes, totalSubmissions),
          orphan: false,
        },
        {
          optionId: 'false',
          label: 'Tidak',
          count: no,
          percentage: sharePercentage(no, totalSubmissions),
          orphan: false,
        },
      ],
    };
  }

  if (!hasOptions(field)) return null;

  const used = new Set<string>();
  const options: ReportOptionShare[] = field.options.map((option) => {
    // Jawaban boleh menyimpan `id` maupun `value` — keduanya diterima saat
    // submit, jadi keduanya perlu dijumlahkan ke opsi yang sama.
    const keys = [option.id, optionValue(option)];
    let count = 0;

    for (const key of new Set(keys)) {
      count += counts.get(key) ?? 0;
      used.add(key);
    }

    return {
      optionId: option.id,
      label: option.label,
      count,
      percentage: sharePercentage(count, respondents),
      orphan: false,
    };
  });

  for (const [key, count] of counts) {
    if (used.has(key)) continue;

    options.push({
      optionId: key,
      label: key,
      count,
      percentage: sharePercentage(count, respondents),
      orphan: true,
    });
  }

  return {
    fieldId: field.id,
    label: field.label,
    type: field.type,
    respondents,
    options,
  };
}
