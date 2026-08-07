import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser, AuthTokens } from '@formz/shared';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UserPermissionsService } from '../rbac/user-permissions.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

const PASSWORD = 'password-yang-benar-123';

const TOKENS: AuthTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenType: 'Bearer',
  expiresIn: 900,
};

const AUTHENTICATED_USER: AuthenticatedUser = {
  id: 'user-1',
  email: 'admin@example.com',
  name: 'Admin',
  isActive: true,
  roles: [{ id: 'role-1', name: 'Super Admin' }],
  permissions: ['user.manage'],
};

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: { user: { findUnique: jest.Mock } };
  let tokenService: {
    issueTokens: jest.Mock;
    rotateRefreshToken: jest.Mock;
    revokeAllSessions: jest.Mock;
    revokeRefreshToken: jest.Mock;
  };
  let userPermissions: { findAuthenticatedUser: jest.Mock };
  let passwordHash: string;

  beforeAll(async () => {
    // Cost rendah supaya test cepat; nilai produksinya diatur lewat BCRYPT_ROUNDS.
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };
    tokenService = {
      issueTokens: jest.fn().mockResolvedValue(TOKENS),
      rotateRefreshToken: jest.fn(),
      revokeAllSessions: jest.fn().mockResolvedValue(undefined),
      revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
    };
    userPermissions = { findAuthenticatedUser: jest.fn().mockResolvedValue(AUTHENTICATED_USER) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokenService },
        { provide: UserPermissionsService, useValue: userPermissions },
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('mengembalikan user beserta token saat email & password benar', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        passwordHash,
        isActive: true,
      });

      const result = await authService.login({ email: 'admin@example.com', password: PASSWORD });

      expect(result.tokens).toEqual(TOKENS);
      expect(result.user).toEqual(AUTHENTICATED_USER);
      expect(tokenService.issueTokens).toHaveBeenCalledWith({
        id: 'user-1',
        email: 'admin@example.com',
      });
    });

    it('menolak password yang salah', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        passwordHash,
        isActive: true,
      });

      await expect(
        authService.login({ email: 'admin@example.com', password: 'password-salah' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(tokenService.issueTokens).not.toHaveBeenCalled();
    });

    it('menolak email yang tidak terdaftar', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'bukan-siapa-siapa@example.com', password: PASSWORD }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('memberi pesan yang sama untuk email tidak terdaftar dan password salah', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const unknownEmail = await authService
        .login({ email: 'tidak-ada@example.com', password: PASSWORD })
        .catch((error: Error) => error.message);

      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'admin@example.com',
        passwordHash,
        isActive: true,
      });
      const wrongPassword = await authService
        .login({ email: 'admin@example.com', password: 'salah' })
        .catch((error: Error) => error.message);

      // Kalau pesannya berbeda, endpoint login bisa dipakai menebak email terdaftar.
      expect(unknownEmail).toBe(wrongPassword);
    });

    it('menolak user yang sudah dinonaktifkan', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        passwordHash,
        isActive: false,
      });

      await expect(
        authService.login({ email: 'admin@example.com', password: PASSWORD }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('refresh', () => {
    it('menerbitkan token baru untuk refresh token yang sah', async () => {
      tokenService.rotateRefreshToken.mockResolvedValue({ userId: 'user-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        isActive: true,
      });

      const result = await authService.refresh('refresh-token');

      expect(result.tokens).toEqual(TOKENS);
      expect(tokenService.rotateRefreshToken).toHaveBeenCalledWith('refresh-token');
    });

    it('mencabut semua sesi kalau akun sudah dinonaktifkan setelah token terbit', async () => {
      tokenService.rotateRefreshToken.mockResolvedValue({ userId: 'user-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        isActive: false,
      });

      await expect(authService.refresh('refresh-token')).rejects.toThrow(ForbiddenException);
      expect(tokenService.revokeAllSessions).toHaveBeenCalledWith('user-1');
    });
  });

  describe('logout', () => {
    it('mencabut refresh token yang dikirim', async () => {
      await authService.logout('refresh-token');

      expect(tokenService.revokeRefreshToken).toHaveBeenCalledWith('refresh-token');
    });
  });
});
