import type { AuthTokens, AuthenticatedUser } from '@formz/shared';
import { authStore } from './auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Error dari API yang membawa status HTTP dan detail validasi kalau ada. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Daftar pesan per field dari ZodValidationPipe, kalau ada. */
  get fieldErrors(): Array<{ field: string; message: string }> {
    const details = this.details as { errors?: Array<{ field?: string; message?: string }> };

    if (!Array.isArray(details?.errors)) return [];

    return details.errors
      .filter((error) => typeof error.message === 'string')
      .map((error) => ({ field: error.field ?? '', message: error.message as string }));
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Endpoint publik (login/refresh) tidak perlu Authorization header. */
  skipAuth?: boolean;
}

/**
 * Menjaga agar beberapa request yang bersamaan kena 401 hanya memicu satu
 * kali refresh, bukan satu refresh per request. Tanpa ini, request paralel
 * akan saling membatalkan karena refresh token diputar setiap dipakai.
 */
let refreshPromise: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refreshToken = authStore.getRefreshToken();

  if (!refreshToken) return false;

  refreshPromise ??= (async () => {
    try {
      const response = await fetch(`${API_URL}/admin/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        authStore.clear();
        return false;
      }

      const data = (await response.json()) as { tokens: AuthTokens };
      authStore.setTokens(data.tokens);
      return true;
    } catch {
      authStore.clear();
      return false;
    } finally {
      // Dilepas di tick berikutnya supaya request yang antre sempat ikut hasil ini.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload) return payload;

  const body = payload as { message?: unknown };

  if (typeof body?.message === 'string') return body.message;
  if (Array.isArray(body?.message)) return body.message.join(', ');

  return fallback;
}

async function send<T>(path: string, options: RequestOptions, retry = true): Promise<T> {
  const { body, skipAuth, headers, ...rest } = options;
  const accessToken = authStore.getAccessToken();

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(skipAuth || !accessToken ? {} : { Authorization: `Bearer ${accessToken}` }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  // Access token kedaluwarsa: perbarui sekali lalu ulangi request aslinya.
  if (response.status === 401 && !skipAuth && retry) {
    const refreshed = await refreshTokens();
    if (refreshed) return send<T>(path, options, false);
  }

  const payload = await parseBody(response);

  if (!response.ok) {
    throw new ApiError(
      extractMessage(payload, `Permintaan gagal (HTTP ${response.status})`),
      response.status,
      payload,
    );
  }

  return payload as T;
}

export const apiClient = {
  get: <T>(path: string) => send<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) => send<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => send<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => send<T>(path, { method: 'DELETE' }),

  login: (email: string, password: string) =>
    send<{ user: AuthenticatedUser; tokens: AuthTokens }>('/admin/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuth: true,
    }),

  logout: async () => {
    const refreshToken = authStore.getRefreshToken();

    if (refreshToken) {
      // Kegagalan logout di server tidak boleh menahan user keluar dari dashboard.
      await send('/admin/auth/logout', { method: 'POST', body: { refreshToken } }).catch(
        () => undefined,
      );
    }

    authStore.clear();
  },

  me: () => send<AuthenticatedUser>('/admin/auth/me', { method: 'GET' }),
};

export { API_URL };
