import { publicFormSchema, type PublicForm, type SubmissionPayload } from '@formz/shared';
import { submissionResultSchema, type SubmissionResult } from '@formz/shared';

/**
 * Klien untuk dua endpoint publik. Sengaja hanya dua: renderer tidak punya
 * fungsi yang bisa menyentuh daftar submission, reporting, atau user, dan tidak
 * pernah mengirim token apa pun (ARCHITECTURE.md bagian 3.2).
 */

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/** Header tempat renderer melaporkan halaman yang memasangnya, untuk cek whitelist. */
const PARENT_HEADER = 'X-Formz-Parent';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Error per field dari server, dipetakan ke field id. */
    readonly fieldErrors: Record<string, string[]> = {},
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchPublicForm(formKey: string, signal?: AbortSignal): Promise<PublicForm> {
  const response = await request(`${API_URL}/public/forms/${encodeURIComponent(formKey)}/schema`, {
    method: 'GET',
    signal,
  });

  // Di-parse ulang dengan schema yang sama yang dipakai server saat menyimpan.
  // Kalau bentuknya menyimpang, ketahuan di sini alih-alih jadi render yang aneh.
  const parsed = publicFormSchema.safeParse(response);

  if (!parsed.success) {
    throw new ApiError('Schema form tidak bisa dibaca', 500);
  }

  return parsed.data;
}

export async function submitForm(
  formKey: string,
  payload: SubmissionPayload,
): Promise<SubmissionResult> {
  const response = await request(`${API_URL}/public/forms/${encodeURIComponent(formKey)}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const parsed = submissionResultSchema.safeParse(response);

  if (!parsed.success) {
    throw new ApiError('Respons server tidak dikenali', 500);
  }

  return parsed.data;
}

// ---------------------------------------------------------------------------

async function request(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      // Endpoint publik anonim: jangan sampai cookie apa pun ikut terkirim.
      credentials: 'omit',
      headers: { ...init.headers, [PARENT_HEADER]: parentUrl() },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;

    throw new ApiError('Tidak bisa menghubungi server. Periksa koneksi internet.', 0);
  }

  const body = await readJson(response);

  if (!response.ok) {
    throw new ApiError(
      messageOf(body) ?? `Permintaan gagal (${response.status})`,
      response.status,
      fieldErrorsOf(body),
      retryAfterOf(response, body),
    );
  }

  return body;
}

/**
 * URL halaman yang memasang form. Di dalam iframe, `document.referrer` berisi
 * URL halaman induk — inilah satu-satunya cara server bisa tahu di domain mana
 * form dipasang, karena header `Origin` selalu menunjuk ke renderer sendiri.
 */
function parentUrl(): string {
  return window.parent !== window ? document.referrer : '';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;

  const message = (body as { message?: unknown }).message;

  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];

  return null;
}

/** `errors` dari server berbentuk `AnswerIssue[]`, dikelompokkan per field id. */
function fieldErrorsOf(body: unknown): Record<string, string[]> {
  if (typeof body !== 'object' || body === null) return {};

  const errors = (body as { errors?: unknown }).errors;

  if (!Array.isArray(errors)) return {};

  const grouped: Record<string, string[]> = {};

  for (const issue of errors) {
    if (typeof issue !== 'object' || issue === null) continue;

    const { fieldId, message } = issue as { fieldId?: unknown; message?: unknown };

    if (typeof fieldId !== 'string' || typeof message !== 'string') continue;

    (grouped[fieldId] ??= []).push(message);
  }

  return grouped;
}

function retryAfterOf(response: Response, body: unknown): number | undefined {
  const header = Number(response.headers.get('Retry-After'));

  if (Number.isFinite(header) && header > 0) return header;

  const fromBody = (body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;

  return typeof fromBody === 'number' ? fromBody : undefined;
}
