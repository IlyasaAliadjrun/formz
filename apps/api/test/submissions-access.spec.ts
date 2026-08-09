import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '@formz/shared';
import request from 'supertest';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { TokenService } from '../src/modules/auth/token.service';
import { CaslAbilityFactory } from '../src/modules/rbac/casl-ability.factory';
import { PermissionsGuard } from '../src/modules/rbac/guards/permissions.guard';
import { UserPermissionsService } from '../src/modules/rbac/user-permissions.service';
import { SubmissionExportService } from '../src/modules/submissions/submission-export.service';
import { SubmissionsController } from '../src/modules/submissions/submissions.controller';
import { SubmissionsService } from '../src/modules/submissions/submissions.service';

/**
 * Akses /admin/submissions. Poin utamanya: melihat submission dan mengunduh
 * semuanya jadi satu berkas adalah dua kemampuan yang berbeda, jadi dijaga
 * permission yang berbeda pula.
 */

const FORM_ID = '55555555-5555-4555-8555-555555555555';
const SUBMISSION_ID = '66666666-6666-4666-8666-666666666666';

/** Punya submission.view tapi tidak punya submission.export. */
const VIEWER: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'viewer@example.com',
  name: 'Viewer',
  isActive: true,
  roles: [{ id: 'role-viewer', name: 'Viewer' }],
  permissions: ['form.view', 'submission.view', 'report.view'],
};

const ANALYST: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'analis@example.com',
  name: 'Analis',
  isActive: true,
  roles: [{ id: 'role-analyst', name: 'Analis' }],
  permissions: ['submission.view', 'submission.export'],
};

/** Tidak punya permission submission sama sekali. */
const EDITOR: AuthenticatedUser = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'editor@example.com',
  name: 'Editor',
  isActive: true,
  roles: [{ id: 'role-editor', name: 'Editor Form' }],
  permissions: ['form.view', 'form.edit'],
};

const TOKEN_TO_USER: Record<string, AuthenticatedUser> = {
  'token-viewer': VIEWER,
  'token-analyst': ANALYST,
  'token-editor': EDITOR,
};

describe('Akses /admin/submissions', () => {
  let app: INestApplication;
  let submissions: { list: jest.Mock; findById: jest.Mock };
  let exporter: { export: jest.Mock };

  beforeEach(async () => {
    submissions = {
      list: jest.fn().mockResolvedValue({ data: [], meta: {}, columns: [], form: {} }),
      findById: jest.fn().mockResolvedValue({ id: SUBMISSION_ID }),
    };

    exporter = {
      export: jest.fn().mockResolvedValue({
        filename: 'form-2026-08-09.csv',
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from('kolom\nnilai\n'),
        truncated: false,
        rowCount: 1,
      }),
    };

    const tokenService = {
      verifyAccessToken: jest.fn((token: string) => {
        const user = TOKEN_TO_USER[token];
        if (!user) return Promise.reject(new UnauthorizedException('Token tidak valid'));
        return Promise.resolve({ sub: user.id, email: user.email });
      }),
    };

    const userPermissions = {
      findAuthenticatedUser: jest.fn((userId: string) =>
        Promise.resolve(Object.values(TOKEN_TO_USER).find((user) => user.id === userId) ?? null),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [SubmissionsController],
      providers: [
        { provide: SubmissionsService, useValue: submissions },
        { provide: SubmissionExportService, useValue: exporter },
        { provide: TokenService, useValue: tokenService },
        { provide: UserPermissionsService, useValue: userPermissions },
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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const listUrl = `/admin/submissions?form_id=${FORM_ID}`;
  const exportUrl = `/admin/submissions/export?form_id=${FORM_ID}`;

  describe('tanpa token', () => {
    it.each([
      ['daftar', listUrl],
      ['detail', `/admin/submissions/${SUBMISSION_ID}`],
      ['ekspor', exportUrl],
    ])('menolak %s dengan 401', async (_name, url) => {
      await request(app.getHttpServer()).get(url).expect(401);
    });
  });

  describe('permission', () => {
    it('Viewer boleh melihat daftar', async () => {
      await request(app.getHttpServer()).get(listUrl).set(auth('token-viewer')).expect(200);

      expect(submissions.list).toHaveBeenCalledTimes(1);
    });

    it('Viewer boleh membuka detail', async () => {
      await request(app.getHttpServer())
        .get(`/admin/submissions/${SUBMISSION_ID}`)
        .set(auth('token-viewer'))
        .expect(200);
    });

    it('Viewer ditolak saat mengekspor karena tidak punya submission.export', async () => {
      const response = await request(app.getHttpServer())
        .get(exportUrl)
        .set(auth('token-viewer'))
        .expect(403);

      expect(response.body.message).toContain('submission.export');
      expect(exporter.export).not.toHaveBeenCalled();
    });

    it('Editor tanpa permission submission ditolak melihat daftar', async () => {
      await request(app.getHttpServer()).get(listUrl).set(auth('token-editor')).expect(403);

      expect(submissions.list).not.toHaveBeenCalled();
    });

    it('Analis boleh mengekspor', async () => {
      const response = await request(app.getHttpServer())
        .get(exportUrl)
        .set(auth('token-analyst'))
        .expect(200);

      expect(response.headers['content-disposition']).toContain('form-2026-08-09.csv');
      expect(response.headers['x-export-rows']).toBe('1');
    });
  });

  describe('urutan rute', () => {
    it('/export tidak tertangkap handler detail', async () => {
      // Kalau `:id` dideklarasikan lebih dulu, permintaan ini akan masuk ke sana
      // dan ditolak ParseUUIDPipe dengan 400 — bukan mengunduh berkas.
      await request(app.getHttpServer()).get(exportUrl).set(auth('token-analyst')).expect(200);

      expect(exporter.export).toHaveBeenCalledTimes(1);
      expect(submissions.findById).not.toHaveBeenCalled();
    });
  });

  describe('validasi query', () => {
    it('menolak form_id yang bukan UUID', async () => {
      await request(app.getHttpServer())
        .get('/admin/submissions?form_id=bukan-uuid')
        .set(auth('token-viewer'))
        .expect(400);
    });

    it('menolak rentang tanggal terbalik', async () => {
      await request(app.getHttpServer())
        .get(`${listUrl}&from=2026-08-09&to=2026-08-01`)
        .set(auth('token-viewer'))
        .expect(400);
    });

    it('menerima ejaan camelCase maupun snake_case', async () => {
      await request(app.getHttpServer())
        .get(`/admin/submissions?formId=${FORM_ID}&perPage=10`)
        .set(auth('token-viewer'))
        .expect(200);

      expect(submissions.list).toHaveBeenCalledWith(
        expect.objectContaining({ formId: FORM_ID, perPage: 10 }),
      );
    });

    it('menolak format ekspor yang tidak dikenal', async () => {
      await request(app.getHttpServer())
        .get(`${exportUrl}&format=pdf`)
        .set(auth('token-analyst'))
        .expect(400);
    });
  });
});
