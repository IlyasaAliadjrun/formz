import type { AuthTokens, AuthenticatedUser } from '@formz/shared';

/**
 * Penyimpanan token di sisi browser.
 *
 * Token disimpan di localStorage supaya sesi bertahan saat halaman di-reload.
 * Konsekuensinya token bisa dibaca skrip yang berjalan di origin ini — dashboard
 * memang tidak pernah menampilkan konten pihak ketiga, dan form renderer (yang
 * dipasang di website orang lain) sengaja dibuat sebagai aplikasi terpisah tanpa
 * token sama sekali. Untuk pengerasan lebih lanjut, cookie httpOnly dari sisi
 * server adalah langkah berikutnya (dicatat di PROGRESS.md Part 10).
 */

const ACCESS_TOKEN_KEY = 'formz.accessToken';
const REFRESH_TOKEN_KEY = 'formz.refreshToken';

type Listener = () => void;

const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export const authStore = {
  getAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  },

  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  },

  setTokens(tokens: AuthTokens): void {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    window.localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    notify();
  },

  clear(): void {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    notify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export type { AuthTokens, AuthenticatedUser };
