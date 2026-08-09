import { REPORT_VIEWS, type ReportViewName } from '@formz/shared';
import { pool } from '../connections';

/**
 * Refresh materialized view laporan.
 *
 * ## Kenapa CONCURRENTLY
 *
 * `REFRESH MATERIALIZED VIEW` tanpa `CONCURRENTLY` mengunci view-nya dengan
 * ACCESS EXCLUSIVE selama perhitungan berjalan — halaman laporan yang kebetulan
 * dibuka saat itu akan menggantung sampai selesai. Versi concurrent membangun
 * salinan baru lalu menukarnya, jadi pembaca tidak pernah terhalang. Harganya
 * dua: perhitungannya lebih lambat, dan setiap view **wajib** punya unique index
 * (sudah dibuat di migrasi yang membuat view-nya).
 *
 * ## Kenapa nama view disisipkan ke SQL
 *
 * `REFRESH` tidak menerima nama relasi sebagai parameter terikat — tidak ada
 * bentuk `REFRESH MATERIALIZED VIEW $1`. Yang disisipkan karena itu wajib
 * berasal dari `REPORT_VIEWS` di `@formz/shared`, sebuah konstanta `as const`,
 * dan tidak boleh pernah berasal dari input. Tipe `ReportViewName` yang membuat
 * aturan itu ditegakkan compiler, bukan sekadar dijanjikan komentar ini.
 */

export interface ViewRefreshResult {
  name: ReportViewName;
  durationMs: number;
  rowCount: number;
}

export async function refreshReportView(view: ReportViewName): Promise<ViewRefreshResult> {
  // Pengaman kedua di runtime, kalau-kalau pemanggilnya menembus tipe lewat cast.
  if (!REPORT_VIEWS.includes(view)) {
    throw new Error(`"${view}" bukan materialized view laporan`);
  }

  const started = Date.now();

  await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);

  const durationMs = Date.now() - started;
  const { rows } = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM ${view}`);

  return { name: view, durationMs, rowCount: Number(rows[0]?.count ?? 0) };
}

/**
 * Mencatat refresh yang berhasil.
 *
 * `refreshed_at` hanya ditulis di sini, tidak di jalur kegagalan: yang ingin
 * diketahui pembaca laporan adalah kapan angka di layarnya benar-benar dihitung
 * ulang, bukan kapan terakhir kali ada yang mencoba.
 */
export async function recordRefreshSuccess(result: ViewRefreshResult): Promise<void> {
  await pool.query(
    `INSERT INTO report_refresh_state
            (view_name, refreshed_at, duration_ms, row_count, error_message, updated_at)
     VALUES ($1, now(), $2, $3, NULL, now())
     ON CONFLICT (view_name) DO UPDATE
        SET refreshed_at  = excluded.refreshed_at,
            duration_ms   = excluded.duration_ms,
            row_count     = excluded.row_count,
            error_message = NULL,
            updated_at    = now()`,
    [result.name, result.durationMs, result.rowCount],
  );
}

export async function recordRefreshFailure(view: ReportViewName, message: string): Promise<void> {
  await pool.query(
    `INSERT INTO report_refresh_state (view_name, error_message, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (view_name) DO UPDATE
        SET error_message = excluded.error_message,
            updated_at    = now()`,
    // Pesan error Postgres bisa panjang; dipotong supaya satu kegagalan tidak
    // menyimpan kilobyte teks di tabel yang isinya empat baris.
    [view, message.slice(0, 1000)],
  );
}
