import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserPermissionsService } from '../../rbac/user-permissions.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-request';
import { TokenService } from '../token.service';

/**
 * Satu-satunya endpoint di bawah /admin yang boleh diakses tanpa token.
 * Daftar ini sengaja hardcoded: menandai endpoint /admin lain dengan @Public()
 * akan ditolak guard, jadi namespace admin tidak bisa terbuka karena kelalaian.
 */
const ADMIN_ROUTES_WITHOUT_TOKEN = new Set(['/admin/auth/login', '/admin/auth/refresh']);

const ADMIN_PREFIX = '/admin';

/**
 * Guard autentikasi yang dipasang global (lihat AppModule).
 *
 * Semua endpoint tertutup secara default; endpoint publik harus menyatakan diri
 * lewat @Public(). Pola fail-closed ini dipilih supaya endpoint baru yang lupa
 * dipikirkan aspek auth-nya ikut terlindungi, bukan malah terbuka.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly userPermissions: UserPermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = normalizePath(request.path ?? request.url ?? '');
    const isAdminRoute = path === ADMIN_PREFIX || path.startsWith(`${ADMIN_PREFIX}/`);

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      if (isAdminRoute && !ADMIN_ROUTES_WITHOUT_TOKEN.has(path)) {
        // Fail closed, bukan sekadar warning: endpoint admin tidak boleh publik.
        this.logger.error(
          `Endpoint admin ${path} ditandai @Public() — ditolak. ` +
            'Hapus @Public(), atau daftarkan di ADMIN_ROUTES_WITHOUT_TOKEN kalau memang disengaja.',
        );
        throw new ForbiddenException('Endpoint admin tidak boleh diakses tanpa autentikasi');
      }

      return true;
    }

    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Header Authorization: Bearer <token> tidak ada');
    }

    const payload = await this.tokenService.verifyAccessToken(token);
    const user = await this.userPermissions.findAuthenticatedUser(payload.sub);

    if (!user) {
      // Token valid tapi user-nya sudah dihapus.
      throw new UnauthorizedException('User pemilik token tidak ditemukan');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Akun ini sudah dinonaktifkan');
    }

    request.user = user;

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const [scheme, value] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;

  return value.trim() || null;
}

/** Membuang query string dan trailing slash supaya pencocokan path konsisten. */
function normalizePath(raw: string): string {
  const path = raw.split('?')[0] ?? '';

  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
