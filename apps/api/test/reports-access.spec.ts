import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PERMISSIONS, type AuthenticatedUser } from '@formz/shared';
import request from 'supertest';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { TokenService } from '../src/modules/auth/token.service';
import { QueueService } from '../src/modules/queue/queue.service';
import { CaslAbilityFactory } from '../src/modules/rbac/casl-ability.factory';
import { PermissionsGuard } from '../src/modules/rbac/guards/permissions.guard';
import { UserPermissionsService } from '../src/modules/rbac/user-permissions.service';
import { ReportExportService } from '../src/modules/reporting/report-export.service';
import { ReportingController } from '../src/modules/reporting/reporting.controller';
import { ReportingService } from '../src/modules/reporting/reporting.service';

/**
 * Akses /admin/reports.
 *
 * Laporan menampilkan sebaran jawaban seluruh submission sebuah form. Angkanya
 * memang agregat, tapi pada form dengan sedikit kiriman sebaran itu bisa nyaris
 * sama informatifnya dengan membaca jawabannya satu per satu — jadi
 * `report.view` di sini menjaga hal yang sama seperti `submission.view` di
 * tempatnya.
 */

const FORM_ID = '019fe6ff-763f-73d1-b184-361722ac81d4';

const ADMIN: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.com',
  name: 'Super Admin',
  isActive: true,
  roles: [{ id: 'role-super', name: 'Super Admin' }],
  permissions: PERMISSIONS.map((permission) => permission.key),
};

/** Boleh membuka form dan submission, tapi laporannya tidak. */
const OPERATOR: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'operator@example.com',
  name: 'Operator',
  isActive: true,
  roles: [{ id: 'role-operator', name: 'Operator' }],
  permissions: ['form.view', 'submission.view', 'submission.export'],
};

const TOKEN_TO_USER: Record<string, AuthenticatedUser> = {
  'token-admin': ADMIN,
  'token-operator': OPERATOR,
};

describe('Akses /admin/reports', () => {
  let app: INestApplication;
  let reporting: Record<string, jest.Mock>;
  let exporter: Record<string, jest.Mock>;
  let queue: { requestReportRefresh: jest.Mock };

  beforeEach(async () => {
    reporting = {
      overview: jest.fn().mockResolvedValue({ form: { id: FORM_ID }, trend: [] }),
    };

    exporter = {
      export: jest.fn().mockResolvedValue({
        filename: 'laporan.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: Buffer.from('xlsx'),
      }),
    };

    queue = { requestReportRefresh: jest.fn().mockResolvedValue(true) };

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
      controllers: [ReportingController],
      providers: [
        { provide: ReportingService, useValue: reporting },
        { provide: ReportExportService, useValue: exporter },
        { provide: QueueService, useValue: queue },
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

  describe('tanpa token', () => {
    it.each([
      ['ringkasan', 'get', `/admin/reports/overview?form_id=${FORM_ID}`],
      ['ekspor', 'get', `/admin/reports/export?form_id=${FORM_ID}`],
      ['hitung ulang', 'post', '/admin/reports/refresh'],
    ])('menolak %s dengan 401', async (_name, method, url) => {
      await request(app.getHttpServer())[method as 'get' | 'post'](url).expect(401);
    });
  });

  describe('permission report.view', () => {
    it('Super Admin boleh membaca ringkasan', async () => {
      await request(app.getHttpServer())
        .get(`/admin/reports/overview?form_id=${FORM_ID}`)
        .set(auth('token-admin'))
        .expect(200);

      expect(reporting.overview).toHaveBeenCalledTimes(1);
    });

    it('Operator tanpa report.view ditolak membaca ringkasan', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/reports/overview?form_id=${FORM_ID}`)
        .set(auth('token-operator'))
        .expect(403);

      expect(response.body.message).toContain('report.view');
      expect(reporting.overview).not.toHaveBeenCalled();
    });

    it('Operator tanpa report.view ditolak mengekspor', async () => {
      // `submission.export` yang ia punya sengaja tidak berlaku di sini: yang
      // diekspor endpoint ini laporan, bukan daftar submission.
      await request(app.getHttpServer())
        .get(`/admin/reports/export?form_id=${FORM_ID}`)
        .set(auth('token-operator'))
        .expect(403);

      expect(exporter.export).not.toHaveBeenCalled();
    });

    it('Operator tanpa report.view ditolak meminta hitung ulang', async () => {
      await request(app.getHttpServer())
        .post('/admin/reports/refresh')
        .set(auth('token-operator'))
        .expect(403);

      expect(queue.requestReportRefresh).not.toHaveBeenCalled();
    });
  });

  describe('validasi query', () => {
    it('menolak form_id yang bukan UUID', async () => {
      await request(app.getHttpServer())
        .get('/admin/reports/overview?form_id=bukan-uuid')
        .set(auth('token-admin'))
        .expect(400);

      expect(reporting.overview).not.toHaveBeenCalled();
    });

    it('menolak rentang tanggal terbalik', async () => {
      await request(app.getHttpServer())
        .get(`/admin/reports/overview?form_id=${FORM_ID}&from=2026-08-09&to=2026-08-01`)
        .set(auth('token-admin'))
        .expect(400);

      expect(reporting.overview).not.toHaveBeenCalled();
    });

    it('menolak granularity di luar hari/minggu', async () => {
      await request(app.getHttpServer())
        .get(`/admin/reports/overview?form_id=${FORM_ID}&granularity=jam`)
        .set(auth('token-admin'))
        .expect(400);

      expect(reporting.overview).not.toHaveBeenCalled();
    });

    it('menerima form_id maupun formId, dan default granularity harian', async () => {
      await request(app.getHttpServer())
        .get(`/admin/reports/overview?formId=${FORM_ID}`)
        .set(auth('token-admin'))
        .expect(200);

      expect(reporting.overview).toHaveBeenCalledWith(
        expect.objectContaining({ formId: FORM_ID, granularity: 'day' }),
      );
    });

    it('memangkas bagian jam dari batas rentang berformat ISO', async () => {
      // Agregasinya per hari, jadi jam tidak bisa ditepati apa adanya —
      // dipangkas terang-terangan alih-alih diam-diam diabaikan di query.
      await request(app.getHttpServer())
        .get(`/admin/reports/overview?form_id=${FORM_ID}&from=2026-08-01T13:45:00Z`)
        .set(auth('token-admin'))
        .expect(200);

      expect(reporting.overview).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-08-01' }),
      );
    });
  });

  describe('ekspor', () => {
    it('mengirim berkas .xlsx lengkap dengan nama berkasnya', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/reports/export?form_id=${FORM_ID}`)
        .set(auth('token-admin'))
        .expect(200);

      expect(response.headers['content-disposition']).toContain('laporan.xlsx');
      // Tanpa expose header ini, dashboard yang beda origin tidak bisa membaca
      // nama berkasnya sama sekali.
      expect(response.headers['access-control-expose-headers']).toContain('Content-Disposition');
    });
  });

  describe('hitung ulang', () => {
    it('menjawab 202 dan menyebut permintaannya digabung kalau sudah berjalan', async () => {
      queue.requestReportRefresh.mockResolvedValue(false);

      const response = await request(app.getHttpServer())
        .post('/admin/reports/refresh')
        .set(auth('token-admin'))
        .expect(202);

      expect(response.body.queued).toBe(false);
      expect(response.body.message).toContain('digabung');
    });
  });
});
