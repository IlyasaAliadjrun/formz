import type {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface';
import type { Request } from 'express';
import type { Env } from '../../config/env.schema';
import { isOriginAllowed, type OriginPolicy } from './origin-policy';
import { PARENT_HEADER } from './guards/form-origin.guard';

/**
 * CORS dua kebijakan dalam satu delegasi.
 *
 * Dashboard admin punya satu origin tetap dan mengirim kredensial. Endpoint
 * publik sebaliknya: origin-nya berbeda per form (mengikuti `allowed_domains`)
 * dan tidak boleh menerima kredensial sama sekali.
 *
 * Dipakai sebagai delegasi, bukan dua konfigurasi terpisah, karena origin yang
 * diizinkan baru bisa diketahui setelah formKey di URL dibaca — dan preflight
 * `OPTIONS` tidak pernah sampai ke controller, jadi harus dijawab di lapisan ini.
 */

const PUBLIC_FORM_PATH = /^\/public\/forms\/([A-Za-z0-9_-]+)(?:\/|$)/;

export function createCorsDelegate(
  env: Env,
  resolvePolicy: (formKey: string) => Promise<OriginPolicy | null>,
): CorsOptionsDelegate<Request> {
  const dashboardCors: CorsOptions = { origin: [env.DASHBOARD_URL], credentials: true };

  return (request, callback) => {
    const formKey = formKeyFromPath(request.path ?? request.url ?? '');

    if (!formKey) {
      callback(null, dashboardCors);
      return;
    }

    void resolvePolicy(formKey)
      .then((policy) => {
        const origin = request.headers.origin;

        // formKey tidak dikenal tetap dijawab dengan header CORS terbuka supaya
        // browser bisa membaca 404-nya. Kalau tidak, form yang salah ketik akan
        // memunculkan pesan "diblokir CORS" yang menyesatkan.
        const allowed = policy === null || isOriginAllowed(origin, policy);

        callback(null, {
          origin: allowed ? (origin ?? true) : false,
          // Endpoint publik anonim: tidak ada cookie maupun Authorization yang
          // boleh ikut, jadi token dashboard tidak mungkin terbawa ke sini.
          credentials: false,
          methods: ['GET', 'POST', 'OPTIONS'],
          allowedHeaders: ['Content-Type', PARENT_HEADER],
          exposedHeaders: ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
          maxAge: 600,
        });
      })
      // Gagal di sini berarti cache **dan** database sama-sama tidak bisa dibaca
      // (kegagalan Redis sudah ditelan cache service), jadi 500 memang jawabannya.
      .catch((error: unknown) => callback(error as Error, { origin: false }));
  };
}

export function formKeyFromPath(path: string): string | null {
  const match = PUBLIC_FORM_PATH.exec(path.split('?')[0] ?? '');

  return match?.[1] ?? null;
}
