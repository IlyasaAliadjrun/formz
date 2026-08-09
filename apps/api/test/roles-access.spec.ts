import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PERMISSIONS, type AuthenticatedUser } from '@formz/shared';
import request from 'supertest';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { TokenService } from '../src/modules/auth/token.service';
import { CaslAbilityFactory } from '../src/modules/rbac/casl-ability.factory';
import { PermissionsGuard } from '../src/modules/rbac/guards/permissions.guard';
import { RolesController } from '../src/modules/rbac/roles.controller';
import { RolesService } from '../src/modules/rbac/roles.service';
import { UserPermissionsService } from '../src/modules/rbac/user-permissions.service';

/**
 * Akses /admin/roles.
 *
 * Endpoint ini yang menentukan siapa boleh apa di seluruh aplikasi, jadi
 * pemeriksaannya bukan formalitas: siapa pun yang bisa menyentuhnya sebenarnya
 * bisa memberi dirinya sendiri hak apa pun lewat role yang ia buat.
 */

const ROLE_ID = '55555555-5555-4555-8555-555555555555';

const ADMIN: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.com',
  name: 'Super Admin',
  isActive: true,
  roles: [{ id: 'role-super', name: 'Super Admin' }],
  permissions: PERMISSIONS.map((permission) => permission.key),
};

/** Punya seluruh permission form & submission, tapi bukan pengelola user. */
const MANAGER: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'manager@example.com',
  name: 'Form Manager',
  isActive: true,
  roles: [{ id: 'role-manager', name: 'Form Manager' }],
  permissions: [
    'form.view',
    'form.create',
    'form.edit',
    'form.delete',
    'form.publish',
    'submission.view',
    'submission.export',
    'integration.manage',
    'report.view',
  ],
};

const TOKEN_TO_USER: Record<string, AuthenticatedUser> = {
  'token-admin': ADMIN,
  'token-manager': MANAGER,
};

describe('Akses /admin/roles', () => {
  let app: INestApplication;
  let roles: Record<string, jest.Mock>;

  beforeEach(async () => {
    roles = {
      list: jest.fn().mockResolvedValue({ data: [] }),
      findById: jest.fn().mockResolvedValue({ id: ROLE_ID }),
      create: jest.fn().mockResolvedValue({ id: ROLE_ID }),
      update: jest.fn().mockResolvedValue({ id: ROLE_ID }),
      remove: jest.fn().mockResolvedValue({ id: ROLE_ID }),
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
      controllers: [RolesController],
      providers: [
        { provide: RolesService, useValue: roles },
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
      ['daftar role', '/admin/roles'],
      ['katalog permission', '/admin/roles/permissions'],
      ['detail role', `/admin/roles/${ROLE_ID}`],
    ])('menolak %s dengan 401', async (_name, url) => {
      await request(app.getHttpServer()).get(url).expect(401);
    });
  });

  describe('permission user.manage', () => {
    it('Super Admin boleh membaca daftar role', async () => {
      await request(app.getHttpServer()).get('/admin/roles').set(auth('token-admin')).expect(200);

      expect(roles.list).toHaveBeenCalledTimes(1);
    });

    it('Form Manager ditolak membaca daftar role', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/roles')
        .set(auth('token-manager'))
        .expect(403);

      expect(response.body.message).toContain('user.manage');
      expect(roles.list).not.toHaveBeenCalled();
    });

    it('Form Manager ditolak membuat role baru', async () => {
      await request(app.getHttpServer())
        .post('/admin/roles')
        .set(auth('token-manager'))
        .send({ name: 'Role Sendiri', permissionKeys: ['user.manage'] })
        .expect(403);

      expect(roles.create).not.toHaveBeenCalled();
    });

    it('Form Manager ditolak menghapus role', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/roles/${ROLE_ID}`)
        .set(auth('token-manager'))
        .expect(403);

      expect(roles.remove).not.toHaveBeenCalled();
    });
  });

  describe('katalog permission', () => {
    it('mengembalikan seluruh katalog dari @formz/shared', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/roles/permissions')
        .set(auth('token-admin'))
        .expect(200);

      expect(response.body.data).toHaveLength(PERMISSIONS.length);
      expect(response.body.data.map((item: { key: string }) => item.key)).toContain('user.manage');
    });

    it('tidak tertelan oleh rute :id', async () => {
      // `/permissions` bukan UUID; kalau urutan pendaftaran rutenya terbalik,
      // request ini akan masuk ke handler detail dan ditolak ParseUUIDPipe.
      await request(app.getHttpServer())
        .get('/admin/roles/permissions')
        .set(auth('token-admin'))
        .expect(200);

      expect(roles.findById).not.toHaveBeenCalled();
    });
  });

  describe('validasi body', () => {
    it('menolak permission yang tidak ada di katalog', async () => {
      await request(app.getHttpServer())
        .post('/admin/roles')
        .set(auth('token-admin'))
        .send({ name: 'Role Baru', permissionKeys: ['form.view', 'permission.karangan'] })
        .expect(400);

      expect(roles.create).not.toHaveBeenCalled();
    });

    it('menolak nama role kosong', async () => {
      await request(app.getHttpServer())
        .post('/admin/roles')
        .set(auth('token-admin'))
        .send({ name: '   ', permissionKeys: [] })
        .expect(400);

      expect(roles.create).not.toHaveBeenCalled();
    });

    it('menolak update tanpa perubahan apa pun', async () => {
      await request(app.getHttpServer())
        .put(`/admin/roles/${ROLE_ID}`)
        .set(auth('token-admin'))
        .send({})
        .expect(400);

      expect(roles.update).not.toHaveBeenCalled();
    });

    it('menerima role tanpa permission sama sekali', async () => {
      // Role kosong sah — dipakai sebagai titik awal sebelum permission dicentang.
      await request(app.getHttpServer())
        .post('/admin/roles')
        .set(auth('token-admin'))
        .send({ name: 'Role Kosong' })
        .expect(201);

      expect(roles.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Role Kosong', permissionKeys: [] }),
      );
    });
  });
});
