import { timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Queue } from 'bullmq';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../../config/env.schema';

/**
 * Bull Board — melihat job yang menunggu, gagal, dan sedang berjalan, lengkap
 * dengan pesan error serta tombol retry-nya.
 *
 * ## Kenapa autentikasinya berbeda dari sisanya
 *
 * Bull Board adalah aplikasi Express dengan halaman HTML-nya sendiri, bukan
 * endpoint Nest. Ia tidak bisa memakai JwtAuthGuard karena guard itu menuntut
 * header `Authorization`, sementara ini dibuka lewat address bar browser — dan
 * dashboard menyimpan token di localStorage pada origin yang berbeda, jadi
 * tokennya juga tidak bisa dititipkan lewat cookie tanpa `SameSite=None` yang
 * hanya jalan di HTTPS.
 *
 * Yang dipakai karena itu HTTP Basic auth dengan kredensial terpisah, dan
 * halamannya **tidak dipasang sama sekali** kalau kredensial itu belum diisi.
 * Bawaannya tertutup: lupa mengonfigurasi berarti halamannya tidak ada, bukan
 * halamannya terbuka.
 *
 * Ringkasan antrean untuk dashboard tetap lewat jalur normal
 * (`GET /admin/queues/summary`, ber-permission), jadi admin tidak wajib membuka
 * halaman ini untuk sekadar tahu ada job yang gagal.
 */
export function mountBullBoard(
  app: NestExpressApplication,
  env: Env,
  queues: readonly Queue[],
): boolean {
  const logger = new Logger('BullBoard');

  if (!env.QUEUE_DASHBOARD_USER || !env.QUEUE_DASHBOARD_PASSWORD) {
    logger.warn(
      'Bull Board tidak dipasang — QUEUE_DASHBOARD_USER/QUEUE_DASHBOARD_PASSWORD belum diisi',
    );

    return false;
  }

  const adapter = new ExpressAdapter();
  adapter.setBasePath(env.QUEUE_DASHBOARD_PATH);

  createBullBoard({
    queues: queues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter: adapter,
    options: { uiConfig: { boardTitle: 'Formz Queue' } },
  });

  app.use(
    env.QUEUE_DASHBOARD_PATH,
    basicAuth(env.QUEUE_DASHBOARD_USER, env.QUEUE_DASHBOARD_PASSWORD),
    adapter.getRouter(),
  );

  logger.log(`Bull Board tersedia di ${env.QUEUE_DASHBOARD_PATH} (HTTP Basic auth)`);

  return true;
}

function basicAuth(expectedUser: string, expectedPassword: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const header = request.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');

    if (scheme?.toLowerCase() === 'basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const user = separator === -1 ? decoded : decoded.slice(0, separator);
      const password = separator === -1 ? '' : decoded.slice(separator + 1);

      // Perbandingan waktu tetap: pembanding biasa berhenti di karakter pertama
      // yang berbeda, dan selisih waktunya bisa dipakai menebak isi kredensial.
      if (safeEqual(user, expectedUser) && safeEqual(password, expectedPassword)) {
        next();

        return;
      }
    }

    response
      .status(401)
      .set('WWW-Authenticate', 'Basic realm="Formz Queue", charset="UTF-8"')
      .send('Autentikasi diperlukan');
  };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  // timingSafeEqual menolak buffer yang panjangnya berbeda, jadi panjangnya
  // dicek lebih dulu — panjang kredensial memang bukan rahasia.
  return left.length === right.length && timingSafeEqual(left, right);
}
