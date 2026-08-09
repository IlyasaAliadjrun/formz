import { google, type sheets_v4 } from 'googleapis';
import { env, googlePrivateKey } from '../env';

/**
 * Klien Google Sheets API v4 dengan autentikasi service account.
 *
 * Kredensialnya JWT yang ditandatangani private key dari environment variable —
 * tidak ada layar consent, tidak ada refresh token milik pengguna yang perlu
 * disimpan aplikasi ini. Konsekuensinya service account hanya bisa menyentuh
 * spreadsheet yang **dibagikan kepadanya**, yang justru merupakan pembatasan
 * yang diinginkan. Alasan lengkapnya ada di header
 * `apps/api/src/modules/integrations/integrations.controller.ts`.
 */

/** Scope sesempit yang masih cukup: hanya spreadsheet, bukan seluruh Drive. */
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let client: sheets_v4.Sheets | null = null;

export class GoogleCredentialsMissingError extends Error {
  constructor(
    message = 'Kredensial Google belum diatur. Isi GOOGLE_SERVICE_ACCOUNT_EMAIL dan GOOGLE_PRIVATE_KEY.',
  ) {
    super(message);
    this.name = 'GoogleCredentialsMissingError';
  }
}

/**
 * Klien dibuat sekali lalu dipakai ulang. Pustaka googleapis menyimpan access
 * token hasil pertukaran JWT beserta masa berlakunya di dalam objek auth, jadi
 * membuat klien baru per job berarti satu perjalanan bolak-balik ke Google untuk
 * setiap baris yang disinkronkan.
 */
export function sheetsClient(): sheets_v4.Sheets {
  if (client) return client;

  const key = googlePrivateKey();

  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !key) throw new GoogleCredentialsMissingError();

  if (!isPemPrivateKey(key)) throw new GoogleCredentialsMissingError(INVALID_KEY_MESSAGE);

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key,
    scopes: SCOPES,
  });

  client = google.sheets({ version: 'v4', auth });

  return client;
}

const INVALID_KEY_MESSAGE =
  'GOOGLE_PRIVATE_KEY bukan private key PEM yang sah. Salin nilai "private_key" dari ' +
  'berkas JSON service account apa adanya, termasuk baris BEGIN/END-nya.';

/**
 * Bentuk kunci diperiksa di sini, bukan dibiarkan gagal saat menandatangani JWT.
 * OpenSSL menolak kunci yang salah bentuk dengan pesan seperti
 * `error:1E08010C:DECODER routines::unsupported`, yang tidak memberi petunjuk
 * apa pun tentang variabel mana yang perlu diperbaiki.
 */
function isPemPrivateKey(key: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key);
}

export function hasGoogleCredentials(): boolean {
  const key = googlePrivateKey();

  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && key && isPemPrivateKey(key));
}

/**
 * Nama sheet perlu dikutip di dalam notasi A1 kalau mengandung spasi atau
 * karakter lain, dan kutip tunggal di dalamnya digandakan.
 */
export function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

/** Apakah tab tersebut sudah punya isi di baris pertama. */
export async function hasHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
): Promise<boolean> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!1:1`,
  });

  return (response.data.values?.[0]?.length ?? 0) > 0;
}

export interface AppendResult {
  updatedRange: string | null;
}

export async function appendRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  rows: string[][],
): Promise<AppendResult> {
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`,
    // RAW, bukan USER_ENTERED: jawaban datang dari orang luar, dan
    // USER_ENTERED membuat isian yang diawali `=` dieksekusi sebagai rumus —
    // masalah yang sama dengan yang ditangani escaping CSV di ekspor Part 6.
    valueInputOption: 'RAW',
    // Menyisipkan baris baru alih-alih menimpa sel yang kebetulan sudah terisi
    // di bawah tabel.
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });

  return { updatedRange: response.data.updates?.updatedRange ?? null };
}

/**
 * Memisahkan kegagalan yang layak dicoba ulang dari yang tidak.
 *
 * Kuota terlampaui (429) dan gangguan di sisi Google (5xx) akan pulih sendiri,
 * jadi job-nya diulang dengan backoff. Sebaliknya spreadsheet yang tidak ada
 * (404), belum dibagikan ke service account (403), atau nama tab yang salah
 * (400) tidak akan berubah hanya karena dicoba lagi — mengulanginya lima kali
 * hanya menunda pesan errornya sampai ke layar admin.
 */
export function isRetryableGoogleError(error: unknown): boolean {
  const status = (error as { status?: number; code?: number | string })?.status;
  const code = (error as { code?: number | string })?.code;
  const httpStatus = typeof status === 'number' ? status : typeof code === 'number' ? code : null;

  if (httpStatus !== null) return httpStatus === 429 || httpStatus >= 500;

  // Gangguan jaringan tidak membawa status HTTP sama sekali.
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

/** Pesan error Google terkubur di dalam objek respons; ini menggalinya. */
export function describeGoogleError(error: unknown): string {
  const detail = (
    error as { response?: { data?: { error?: { message?: string; status?: string } } } }
  )?.response?.data?.error;

  if (detail?.message) {
    const message = detail.status ? `${detail.status}: ${detail.message}` : detail.message;

    // 403 di sini hampir selalu berarti satu hal, dan pesan Google tidak
    // menyebutkannya: spreadsheet-nya belum dibagikan ke service account.
    return detail.status === 'PERMISSION_DENIED'
      ? `${message} — pastikan spreadsheet sudah di-share ke ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? 'service account'} sebagai Editor.`
      : message;
  }

  const raw = error instanceof Error ? error.message : String(error);

  // OpenSSL menolak private key yang salah bentuk dengan kode yang tidak
  // memberi tahu apa pun tentang variabel mana yang perlu diperbaiki.
  return /DECODER routines|asn1 encoding|PEM routines/i.test(raw)
    ? `${INVALID_KEY_MESSAGE} (${raw})`
    : raw;
}
