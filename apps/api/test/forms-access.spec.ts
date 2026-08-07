import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '@formz/shared';
import request from 'supertest';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { TokenService } from '../src/modules/auth/token.service';
import { FormsController } from '../src/modules/forms/forms.controller';
import { FormsService } from '../src/modules/forms/forms.service';
import { CaslAbilityFactory } from '../src/modules/rbac/casl-ability.factory';
import { PermissionsGuard } from '../src/modules/rbac/guards/permissions.guard';
import { UserPermissionsService } from '../src/modules/rbac/user-permissions.service';

/**
 * Menguji rantai guard pada /admin/forms: tiap endpoint menuntut permission
 * yang berbeda, jadi satu peran boleh membaca tapi belum tentu boleh mengubah.
 */

const FORM_ID = '33333333-3333-4333-8333-333333333333';

const SUPER_ADMIN: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.com',
  name: 'Admin',
  isActive: true,
  roles: [{ id: 'role-super', name: 'Super Admin' }],
  permissions: [],
};

/** Viewer hanya boleh melihat form, tidak boleh mengubah apa pun. */
const VIEWER: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'viewer@example.com',
  name: 'Viewer',
  isActive: true,
  roles: [{ id: 'role-viewer', name: 'Viewer' }],
  permissions: ['form.view', 'submission.view', 'report.view'],
};

/** Form Manager boleh mengelola form tapi tidak boleh publish. */
const EDITOR: AuthenticatedUser = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'editor@example.com',
  name: 'Editor',
  isActive: true,
  roles: [{ id: 'role-editor', name: 'Editor Form' }],
  permissions: ['form.view', 'form.create', 'form.edit'],
};

const TOKEN_TO_USER: Record<string, AuthenticatedUser> = {
  'token-super-admin': SUPER_ADMIN,
  'token-viewer': VIEWER,
  'token-editor': EDITOR,
};

describe('Akses /admin/forms', () => {
  let app: INestApplication;
  let formsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    formsService = {
      list: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      findById: jest.fn().mockResolvedValue({ id: FORM_ID }),
      create: jest.fn().mockResolvedValue({ id: FORM_ID }),
      update: jest.fn().mockResolvedValue({ id: FORM_ID }),
      publish: jest.fn().mockResolvedValue({ id: FORM_ID }),
      remove: jest.fn().mockResolvedValue({ deleted: true }),
      updateEmbedSettings: jest.fn().mockResolvedValue({ id: FORM_ID }),
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
        Promise.resolve(Object.values(TOKEN_TO_USER).find((u) => u.id === userId) ?? null),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [FormsController],
      providers: [
        { provide: FormsService, useValue: formsService },
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
    type Method = 'get' | 'post' | 'put' | 'delete';

    const send = (method: Method, path: string) => {
      const agent = request(app.getHttpServer());

      switch (method) {
        case 'get':
          return agent.get(path);
        case 'post':
          return agent.post(path);
        case 'put':
          return agent.put(path);
        case 'delete':
          return agent.delete(path);
      }
    };

    it.each<[Method, string]>([
      ['get', '/admin/forms'],
      ['get', `/admin/forms/${FORM_ID}`],
      ['post', '/admin/forms'],
      ['put', `/admin/forms/${FORM_ID}`],
      ['post', `/admin/forms/${FORM_ID}/publish`],
      ['delete', `/admin/forms/${FORM_ID}`],
      ['put', `/admin/forms/${FORM_ID}/embed-settings`],
    ])('menolak %s %s dengan 401', async (method, path) => {
      await send(method, path).expect(401);
    });
  });

  describe('Viewer (hanya form.view)', () => {
    it('boleh membaca daftar form', async () => {
      await request(app.getHttpServer()).get('/admin/forms').set(auth('token-viewer')).expect(200);
      expect(formsService.list).toHaveBeenCalledTimes(1);
    });

    it('boleh membaca detail form', async () => {
      await request(app.getHttpServer())
        .get(`/admin/forms/${FORM_ID}`)
        .set(auth('token-viewer'))
        .expect(200);
    });

    it('ditolak saat membuat form (butuh form.create)', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/forms')
        .set(auth('token-viewer'))
        .send({ title: 'Form Baru' })
        .expect(403);

      expect(response.body.message).toContain('form.create');
      expect(formsService.create).not.toHaveBeenCalled();
    });

    it('ditolak saat mengubah draft (butuh form.edit)', async () => {
      await request(app.getHttpServer())
        .put(`/admin/forms/${FORM_ID}`)
        .set(auth('token-viewer'))
        .send({ title: 'Judul Baru' })
        .expect(403);

      expect(formsService.update).not.toHaveBeenCalled();
    });

    it('ditolak saat menghapus form (butuh form.delete)', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/forms/${FORM_ID}`)
        .set(auth('token-viewer'))
        .expect(403);
    });
  });

  describe('Editor (form.view + form.create + form.edit)', () => {
    it('boleh membuat form', async () => {
      await request(app.getHttpServer())
        .post('/admin/forms')
        .set(auth('token-editor'))
        .send({ title: 'Form Baru' })
        .expect(201);

      expect(formsService.create).toHaveBeenCalledTimes(1);
    });

    it('boleh mengubah whitelist embed karena termasuk form.edit', async () => {
      await request(app.getHttpServer())
        .put(`/admin/forms/${FORM_ID}/embed-settings`)
        .set(auth('token-editor'))
        .send({ allowedDomains: ['example.com'] })
        .expect(200);
    });

    it('ditolak saat publish karena tidak punya form.publish', async () => {
      const response = await request(app.getHttpServer())
        .post(`/admin/forms/${FORM_ID}/publish`)
        .set(auth('token-editor'))
        .send({})
        .expect(403);

      expect(response.body.message).toContain('form.publish');
      expect(formsService.publish).not.toHaveBeenCalled();
    });
  });

  describe('Super Admin', () => {
    it('boleh publish', async () => {
      await request(app.getHttpServer())
        .post(`/admin/forms/${FORM_ID}/publish`)
        .set(auth('token-super-admin'))
        .send({})
        .expect(200);

      expect(formsService.publish).toHaveBeenCalledTimes(1);
    });

    it('boleh menghapus', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/forms/${FORM_ID}`)
        .set(auth('token-super-admin'))
        .expect(200);
    });
  });

  describe('validasi input', () => {
    it('menolak judul kosong saat membuat form', async () => {
      await request(app.getHttpServer())
        .post('/admin/forms')
        .set(auth('token-super-admin'))
        .send({ title: '' })
        .expect(400);
    });

    it('menolak domain yang tidak valid di embed-settings', async () => {
      await request(app.getHttpServer())
        .put(`/admin/forms/${FORM_ID}/embed-settings`)
        .set(auth('token-super-admin'))
        .send({ allowedDomains: ['bukan domain sama sekali'] })
        .expect(400);
    });

    it('menormalkan domain berisi skema dan path menjadi hostname saja', async () => {
      await request(app.getHttpServer())
        .put(`/admin/forms/${FORM_ID}/embed-settings`)
        .set(auth('token-super-admin'))
        .send({ allowedDomains: ['https://App.Example.com/kontak'] })
        .expect(200);

      expect(formsService.updateEmbedSettings).toHaveBeenCalledWith(FORM_ID, {
        allowedDomains: ['app.example.com'],
      });
    });

    it('menolak id form yang bukan UUID', async () => {
      await request(app.getHttpServer())
        .get('/admin/forms/bukan-uuid')
        .set(auth('token-super-admin'))
        .expect(400);
    });
  });
});
