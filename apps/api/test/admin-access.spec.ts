import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '@formz/shared';
import request from 'supertest';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { TokenService } from '../src/modules/auth/token.service';
import { CaslAbilityFactory } from '../src/modules/rbac/casl-ability.factory';
import { PermissionsGuard } from '../src/modules/rbac/guards/permissions.guard';
import { UserPermissionsService } from '../src/modules/rbac/user-permissions.service';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';

/**
 * Test lapisan HTTP untuk namespace /admin.
 *
 * Yang diuji di sini adalah rantai guard-nya, bukan logika bisnisnya — jadi
 * service-nya di-mock, tapi JwtAuthGuard, PermissionsGuard, dan CaslAbilityFactory
 * yang dipakai adalah implementasi asli.
 */

const SUPER_ADMIN: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.com',
  name: 'Admin',
  isActive: true,
  roles: [{ id: 'role-super', name: 'Super Admin' }],
  permissions: ['user.manage'],
};

const VIEWER: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'viewer@example.com',
  name: 'Viewer',
  isActive: true,
  roles: [{ id: 'role-viewer', name: 'Viewer' }],
  permissions: ['submission.view', 'report.view'],
};

const INACTIVE: AuthenticatedUser = { ...VIEWER, id: 'inactive-id', isActive: false };

/** Token palsu → user, supaya tidak perlu menandatangani JWT sungguhan di test. */
const TOKEN_TO_USER: Record<string, AuthenticatedUser> = {
  'token-super-admin': SUPER_ADMIN,
  'token-viewer': VIEWER,
  'token-inactive': INACTIVE,
};

describe('Akses namespace /admin', () => {
  let app: INestApplication;
  let usersService: { list: jest.Mock };

  beforeEach(async () => {
    usersService = { list: jest.fn().mockResolvedValue({ data: [], meta: {} }) };

    const tokenService = {
      verifyAccessToken: jest.fn((token: string) => {
        const user = TOKEN_TO_USER[token];
        if (!user) {
          return Promise.reject(new UnauthorizedException('Access token tidak valid'));
        }
        return Promise.resolve({ sub: user.id, email: user.email });
      }),
    };

    const userPermissions = {
      findAuthenticatedUser: jest.fn(async (userId: string) => {
        return Object.values(TOKEN_TO_USER).find((user) => user.id === userId) ?? null;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController, AuthController],
      providers: [
        { provide: UsersService, useValue: usersService },
        {
          provide: AuthService,
          useValue: { login: jest.fn(), refresh: jest.fn(), logout: jest.fn() },
        },
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

  describe('tanpa token', () => {
    it('menolak GET /admin/users dengan 401', async () => {
      await request(app.getHttpServer()).get('/admin/users').expect(401);
      expect(usersService.list).not.toHaveBeenCalled();
    });

    it('menolak GET /admin/auth/me dengan 401', async () => {
      await request(app.getHttpServer()).get('/admin/auth/me').expect(401);
    });

    it('menolak header Authorization dengan skema selain Bearer', async () => {
      await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', 'Basic YWRtaW46YWRtaW4=')
        .expect(401);
    });

    it('menolak Bearer dengan token yang tidak dikenal', async () => {
      await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', 'Bearer token-palsu')
        .expect(401);
    });

    it('tetap mengizinkan POST /admin/auth/login karena ditandai @Public', async () => {
      // 400 (body kosong gagal validasi Zod), bukan 401 — artinya lolos guard auth.
      await request(app.getHttpServer()).post('/admin/auth/login').send({}).expect(400);
    });
  });

  describe('dengan token tapi permission tidak sesuai', () => {
    it('menolak GET /admin/users untuk Viewer dengan 403', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', 'Bearer token-viewer')
        .expect(403);

      expect(response.body.message).toContain('user.manage');
      expect(usersService.list).not.toHaveBeenCalled();
    });

    it('tetap mengizinkan GET /admin/auth/me karena tidak butuh permission khusus', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/auth/me')
        .set('Authorization', 'Bearer token-viewer')
        .expect(200);

      expect(response.body.email).toBe('viewer@example.com');
    });
  });

  describe('dengan token dan permission yang sesuai', () => {
    it('mengizinkan GET /admin/users untuk Super Admin', async () => {
      await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', 'Bearer token-super-admin')
        .expect(200);

      expect(usersService.list).toHaveBeenCalledTimes(1);
    });
  });

  describe('user nonaktif', () => {
    it('ditolak dengan 403 meski token-nya masih sah', async () => {
      await request(app.getHttpServer())
        .get('/admin/auth/me')
        .set('Authorization', 'Bearer token-inactive')
        .expect(403);
    });
  });
});
