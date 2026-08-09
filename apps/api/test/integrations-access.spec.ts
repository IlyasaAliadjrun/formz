import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '@formz/shared';
import request from 'supertest';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { TokenService } from '../src/modules/auth/token.service';
import {
  IntegrationsController,
  SubmissionIntegrationsController,
} from '../src/modules/integrations/integrations.controller';
import { IntegrationsService } from '../src/modules/integrations/integrations.service';
import { CaslAbilityFactory } from '../src/modules/rbac/casl-ability.factory';
import { PermissionsGuard } from '../src/modules/rbac/guards/permissions.guard';
import { UserPermissionsService } from '../src/modules/rbac/user-permissions.service';

/**
 * Akses /admin/forms/:id/integrations dan /admin/forms/:id/notification-rules.
 *
 * Yang dijaga di sini bukan sekadar "harus login": konfigurasi integrasi memuat
 * alamat email tujuan notifikasi dan id spreadsheet internal, jadi permission-nya
 * dipisah dari `form.edit` — orang yang boleh menyusun field belum tentu boleh
 * mengatur ke mana jawabannya diteruskan.
 */

const FORM_ID = '55555555-5555-4555-8555-555555555555';
const INTEGRATION_ID = '66666666-6666-4666-8666-666666666666';
const RULE_ID = '77777777-7777-4777-8777-777777777777';
const SUBMISSION_ID = '88888888-8888-4888-8888-888888888888';

const OPERATOR: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'operator@example.com',
  name: 'Operator',
  isActive: true,
  roles: [{ id: 'role-operator', name: 'Form Manager' }],
  permissions: ['form.view', 'form.edit', 'submission.view', 'integration.manage'],
};

/** Boleh mengubah form, tapi tidak boleh mengatur integrasinya. */
const EDITOR: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'editor@example.com',
  name: 'Editor',
  isActive: true,
  roles: [{ id: 'role-editor', name: 'Editor Form' }],
  permissions: ['form.view', 'form.edit', 'form.publish'],
};

const TOKEN_TO_USER: Record<string, AuthenticatedUser> = {
  'token-operator': OPERATOR,
  'token-editor': EDITOR,
};

const VALID_RULE_BODY = {
  name: 'Tim panitia',
  subject: 'Submission baru {{form}}',
  recipients: ['panitia@example.com'],
};

describe('Akses /admin/forms/:id/integrations', () => {
  let app: INestApplication;
  let integrations: Record<string, jest.Mock>;

  beforeEach(async () => {
    integrations = {
      listIntegrations: jest.fn().mockResolvedValue([]),
      listNotificationRules: jest.fn().mockResolvedValue([]),
      googleAccount: jest.fn().mockReturnValue({ configured: false, serviceAccountEmail: null }),
      mailStatus: jest.fn().mockReturnValue({ configured: true, provider: 'console', from: null }),
      createIntegration: jest.fn().mockResolvedValue({ id: INTEGRATION_ID }),
      updateIntegration: jest.fn().mockResolvedValue({ id: INTEGRATION_ID }),
      removeIntegration: jest.fn().mockResolvedValue({ id: INTEGRATION_ID }),
      testIntegration: jest.fn().mockResolvedValue({ status: 'synced' }),
      createNotificationRule: jest.fn().mockResolvedValue({ id: RULE_ID }),
      updateNotificationRule: jest.fn().mockResolvedValue({ id: RULE_ID }),
      removeNotificationRule: jest.fn().mockResolvedValue({ id: RULE_ID }),
      testNotificationRule: jest.fn().mockResolvedValue({ deliveries: [] }),
      retrySubmission: jest.fn().mockResolvedValue({ sheetJobs: 1, emailJobs: 0, skipped: [] }),
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
      controllers: [IntegrationsController, SubmissionIntegrationsController],
      providers: [
        { provide: IntegrationsService, useValue: integrations },
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
  const base = `/admin/forms/${FORM_ID}`;

  describe('tanpa token', () => {
    it.each([
      ['pengaturan', `${base}/integration-settings`],
      ['daftar integrasi', `${base}/integrations`],
      ['daftar aturan notifikasi', `${base}/notification-rules`],
    ])('menolak %s dengan 401', async (_name, url) => {
      await request(app.getHttpServer()).get(url).expect(401);
    });

    it('menolak retry manual dengan 401', async () => {
      await request(app.getHttpServer())
        .post(`/admin/submissions/${SUBMISSION_ID}/integrations/retry`)
        .expect(401);
    });
  });

  describe('permission integration.manage', () => {
    it('operator boleh membaca pengaturan', async () => {
      await request(app.getHttpServer())
        .get(`${base}/integration-settings`)
        .set(auth('token-operator'))
        .expect(200);

      expect(integrations.listIntegrations).toHaveBeenCalledWith(FORM_ID);
      expect(integrations.listNotificationRules).toHaveBeenCalledWith(FORM_ID);
    });

    it('editor tanpa integration.manage ditolak membaca pengaturan', async () => {
      const response = await request(app.getHttpServer())
        .get(`${base}/integration-settings`)
        .set(auth('token-editor'))
        .expect(403);

      expect(response.body.message).toContain('integration.manage');
      expect(integrations.listIntegrations).not.toHaveBeenCalled();
    });

    it('editor ditolak membuat aturan notifikasi', async () => {
      await request(app.getHttpServer())
        .post(`${base}/notification-rules`)
        .set(auth('token-editor'))
        .send(VALID_RULE_BODY)
        .expect(403);

      expect(integrations.createNotificationRule).not.toHaveBeenCalled();
    });

    it('editor ditolak menjalankan uji coba', async () => {
      await request(app.getHttpServer())
        .post(`${base}/integrations/${INTEGRATION_ID}/test`)
        .set(auth('token-editor'))
        .expect(403);

      expect(integrations.testIntegration).not.toHaveBeenCalled();
    });

    it('editor ditolak menjalankan ulang integrasi submission', async () => {
      await request(app.getHttpServer())
        .post(`/admin/submissions/${SUBMISSION_ID}/integrations/retry`)
        .set(auth('token-editor'))
        .expect(403);

      expect(integrations.retrySubmission).not.toHaveBeenCalled();
    });

    it('operator boleh menjalankan ulang integrasi submission', async () => {
      const response = await request(app.getHttpServer())
        .post(`/admin/submissions/${SUBMISSION_ID}/integrations/retry`)
        .set(auth('token-operator'))
        .expect(200);

      expect(response.body).toEqual({ sheetJobs: 1, emailJobs: 0, skipped: [] });
    });
  });

  describe('validasi body', () => {
    it('menolak aturan notifikasi tanpa penerima sama sekali', async () => {
      const response = await request(app.getHttpServer())
        .post(`${base}/notification-rules`)
        .set(auth('token-operator'))
        .send({ name: 'Tanpa tujuan', subject: 'Halo' })
        .expect(400);

      expect(JSON.stringify(response.body)).toContain('penerima');
      expect(integrations.createNotificationRule).not.toHaveBeenCalled();
    });

    it('menolak email penerima yang formatnya salah', async () => {
      await request(app.getHttpServer())
        .post(`${base}/notification-rules`)
        .set(auth('token-operator'))
        .send({ ...VALID_RULE_BODY, recipients: ['bukan-email'] })
        .expect(400);

      expect(integrations.createNotificationRule).not.toHaveBeenCalled();
    });

    it('menormalkan URL spreadsheet menjadi id sebelum sampai ke service', async () => {
      await request(app.getHttpServer())
        .post(`${base}/integrations`)
        .set(auth('token-operator'))
        .send({
          config: {
            spreadsheetId: 'https://docs.google.com/spreadsheets/d/1AbC-dEf_1234567890/edit#gid=0',
            sheetName: 'Pendaftar',
          },
        })
        .expect(201);

      expect(integrations.createIntegration).toHaveBeenCalledWith(
        FORM_ID,
        expect.objectContaining({
          config: expect.objectContaining({ spreadsheetId: '1AbC-dEf_1234567890' }),
        }),
      );
    });

    it('menolak id spreadsheet yang jelas bukan id', async () => {
      await request(app.getHttpServer())
        .post(`${base}/integrations`)
        .set(auth('token-operator'))
        .send({ config: { spreadsheetId: 'abc', sheetName: 'Sheet1' } })
        .expect(400);

      expect(integrations.createIntegration).not.toHaveBeenCalled();
    });
  });
});
