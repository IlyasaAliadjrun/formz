import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { APP_ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env.schema';
import { RateLimiterService } from '../src/infrastructure/rate-limit/rate-limiter.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { TokenService } from '../src/modules/auth/token.service';
import { FormOriginGuard } from '../src/modules/public/guards/form-origin.guard';
import { FormRateLimitGuard } from '../src/modules/public/guards/form-rate-limit.guard';
import { PublicFormsController } from '../src/modules/public/public-forms.controller';
import { PublicFormsService } from '../src/modules/public/public-forms.service';
import { CaslAbilityFactory } from '../src/modules/rbac/casl-ability.factory';
import { PermissionsGuard } from '../src/modules/rbac/guards/permissions.guard';
import { UserPermissionsService } from '../src/modules/rbac/user-permissions.service';

/**
 * Menguji lapisan penjaga di depan endpoint publik: tanpa auth, tapi dibatasi
 * whitelist domain dan rate limit (ARCHITECTURE.md bagian 6 poin 4).
 */

const FORM_KEY = 'AbCdEfGhIjKlMnOpQrStUv';
const RENDERER = 'http://localhost:5173';

const RATE_LIMIT_PER_MINUTE = 3;

describe('Akses /public/forms', () => {
  let app: INestApplication;
  // Ditulis eksplisit, bukan Record<string, jest.Mock>, supaya pemanggilan
  // seperti `publicForms.resolve.mockResolvedValue(...)` tidak dianggap
  // mungkin-undefined oleh `noUncheckedIndexedAccess`.
  let publicForms: {
    originPolicy: jest.Mock;
    resolve: jest.Mock;
    getPublicForm: jest.Mock;
    submit: jest.Mock;
  };
  let allowedDomains: string[];

  beforeEach(async () => {
    allowedDomains = [];

    publicForms = {
      originPolicy: jest.fn(() => Promise.resolve({ allowedDomains, rendererOrigin: RENDERER })),
      resolve: jest.fn(() => Promise.resolve({ formKey: FORM_KEY, rateLimitPerHour: null })),
      getPublicForm: jest.fn(() => Promise.resolve({ formKey: FORM_KEY, schema: {} })),
      submit: jest.fn(() => Promise.resolve({ submissionId: 'submission-id', status: 'received' })),
    };

    // Penghitung sungguhan tapi tanpa Redis: cukup untuk memastikan guard
    // benar-benar menolak setelah kuota habis.
    const counters = new Map<string, number>();
    const rateLimiter = {
      consume: jest.fn((key: string, limit: number) => {
        const count = (counters.get(key) ?? 0) + 1;
        counters.set(key, count);

        return Promise.resolve({
          allowed: count <= limit,
          limit,
          remaining: Math.max(0, limit - count),
          retryAfterSeconds: 60,
        });
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicFormsController],
      providers: [
        { provide: PublicFormsService, useValue: publicForms },
        { provide: RateLimiterService, useValue: rateLimiter },
        {
          provide: APP_ENV,
          useValue: {
            EMBED_URL: RENDERER,
            PUBLIC_RATE_LIMIT_PER_MINUTE: RATE_LIMIT_PER_MINUTE,
          } as Env,
        },
        FormOriginGuard,
        FormRateLimitGuard,

        // Guard global ikut dipasang supaya terbukti endpoint publik memang
        // lolos tanpa token — bukan karena guard-nya kebetulan tidak aktif.
        {
          provide: TokenService,
          useValue: {
            verifyAccessToken: jest.fn(() =>
              Promise.reject(new UnauthorizedException('Token tidak valid')),
            ),
          },
        },
        { provide: UserPermissionsService, useValue: { findAuthenticatedUser: jest.fn() } },
        CaslAbilityFactory,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const schemaUrl = `/public/forms/${FORM_KEY}/schema`;

  describe('tanpa autentikasi', () => {
    it('mengizinkan ambil schema tanpa token sama sekali', async () => {
      await request(app.getHttpServer()).get(schemaUrl).expect(200);

      expect(publicForms.getPublicForm).toHaveBeenCalledWith(FORM_KEY);
    });

    it('mengizinkan submit tanpa token', async () => {
      await request(app.getHttpServer())
        .post(`/public/forms/${FORM_KEY}/submit`)
        .send({ answers: { field_001: 'opt_1' } })
        .expect(200);
    });
  });

  describe('validasi formKey', () => {
    it('menolak formKey yang bentuknya tidak mungkin', async () => {
      await request(app.getHttpServer()).get('/public/forms/bukan+form+key/schema').expect(400);

      expect(publicForms.getPublicForm).not.toHaveBeenCalled();
    });
  });

  describe('whitelist domain', () => {
    it('mengizinkan origin mana pun kalau whitelist kosong', async () => {
      await request(app.getHttpServer())
        .get(schemaUrl)
        .set('Origin', 'https://siapa-saja.com')
        .expect(200);
    });

    it('menolak halaman induk di luar whitelist dengan 403', async () => {
      allowedDomains = ['klien.com'];

      const response = await request(app.getHttpServer())
        .get(schemaUrl)
        // Origin selalu menunjuk renderer saat form dibuka di dalam iframe;
        // yang membedakan domain pemasang hanyalah header ini.
        .set('Origin', RENDERER)
        .set('X-Formz-Parent', 'https://pencuri.com/artikel')
        .expect(403);

      expect(response.body.message).toContain('tidak diizinkan');
      expect(publicForms.getPublicForm).not.toHaveBeenCalled();
    });

    it('mengizinkan halaman induk yang ada di whitelist', async () => {
      allowedDomains = ['klien.com'];

      await request(app.getHttpServer())
        .get(schemaUrl)
        .set('Origin', RENDERER)
        .set('X-Formz-Parent', 'https://klien.com/kontak')
        .expect(200);
    });

    it('menolak origin di luar whitelist walau tanpa halaman induk', async () => {
      allowedDomains = ['klien.com'];

      await request(app.getHttpServer())
        .get(schemaUrl)
        .set('Origin', 'https://pencuri.com')
        .expect(403);
    });
  });

  describe('rate limit', () => {
    it('menolak dengan 429 setelah kuota per menit habis', async () => {
      for (let attempt = 0; attempt < RATE_LIMIT_PER_MINUTE; attempt += 1) {
        await request(app.getHttpServer()).get(schemaUrl).expect(200);
      }

      const response = await request(app.getHttpServer()).get(schemaUrl).expect(429);

      expect(response.headers['retry-after']).toBe('60');
      expect(response.body.message).toContain('Terlalu banyak permintaan');
    });

    it('menyertakan sisa kuota di header', async () => {
      const response = await request(app.getHttpServer()).get(schemaUrl).expect(200);

      expect(response.headers['x-ratelimit-limit']).toBe(String(RATE_LIMIT_PER_MINUTE));
      expect(response.headers['x-ratelimit-remaining']).toBe(String(RATE_LIMIT_PER_MINUTE - 1));
    });

    it('menerapkan kuota submit per jam milik form itu sendiri', async () => {
      publicForms.resolve.mockResolvedValue({ formKey: FORM_KEY, rateLimitPerHour: 1 });

      await request(app.getHttpServer())
        .post(`/public/forms/${FORM_KEY}/submit`)
        .send({ answers: {} })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post(`/public/forms/${FORM_KEY}/submit`)
        .send({ answers: {} })
        .expect(429);

      expect(response.body.message).toContain('Batas pengiriman');
    });
  });
});
