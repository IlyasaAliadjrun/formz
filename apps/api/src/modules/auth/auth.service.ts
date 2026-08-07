import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { AuthTokens, AuthenticatedUser } from '@formz/shared';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UserPermissionsService } from '../rbac/user-permissions.service';
import type { LoginDto } from './dto/auth.dto';
import { TokenService } from './token.service';

/**
 * Hash dummy untuk menyamakan waktu proses saat email tidak ditemukan.
 * Tanpa ini, response login untuk email yang ada terasa lebih lambat daripada
 * email yang tidak ada, dan selisih itu bisa dipakai untuk menebak email terdaftar.
 */
const DUMMY_HASH = '$2b$12$EjNOwQYMaU0H1tXZioRMAusdRTSOnNnDD4rj4YxtZ3PM2n/mTHEZe';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly userPermissions: UserPermissionsService,
  ) {}

  async login(dto: LoginDto): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, passwordHash: true, isActive: true },
    });

    const passwordMatches = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);

    // Email salah dan password salah sengaja menghasilkan pesan yang sama,
    // supaya endpoint ini tidak bisa dipakai memeriksa email mana yang terdaftar.
    if (!user || !passwordMatches) {
      this.logger.warn(`Login gagal untuk ${dto.email}`);
      throw new UnauthorizedException('Email atau password salah');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Akun ini sudah dinonaktifkan');
    }

    const authenticatedUser = await this.userPermissions.findAuthenticatedUser(user.id);

    if (!authenticatedUser) {
      throw new UnauthorizedException('User tidak ditemukan');
    }

    const tokens = await this.tokenService.issueTokens({ id: user.id, email: user.email });

    this.logger.log(`Login berhasil: ${user.email}`);

    return { user: authenticatedUser, tokens };
  }

  async refresh(refreshToken: string): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }> {
    const { userId } = await this.tokenService.rotateRefreshToken(refreshToken);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException('User pemilik token tidak ditemukan');
    }

    if (!user.isActive) {
      // Akun dinonaktifkan setelah token terbit — cabut seluruh sesinya.
      await this.tokenService.revokeAllSessions(user.id);
      throw new ForbiddenException('Akun ini sudah dinonaktifkan');
    }

    const authenticatedUser = await this.userPermissions.findAuthenticatedUser(user.id);

    if (!authenticatedUser) {
      throw new UnauthorizedException('User tidak ditemukan');
    }

    const tokens = await this.tokenService.issueTokens({ id: user.id, email: user.email });

    return { user: authenticatedUser, tokens };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokenService.revokeRefreshToken(refreshToken);
  }
}
