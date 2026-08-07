import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@formz/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Memuat user beserta role & permission efektifnya.
 *
 * Sengaja query langsung ke database di setiap request, tidak di-cache dan tidak
 * dititipkan di dalam JWT: pencabutan role harus berlaku seketika. Kalau nanti
 * jadi bottleneck, cache Redis pendek dengan invalidasi saat role berubah bisa
 * ditambahkan di sini tanpa mengubah pemanggilnya.
 */
@Injectable()
export class UserPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        roles: {
          select: {
            role: {
              select: {
                id: true,
                name: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });

    if (!user) return null;

    const roles = user.roles.map(({ role }) => ({ id: role.id, name: role.name }));

    // Permission dari beberapa role digabung dan dideduplikasi.
    const permissions = [
      ...new Set(
        user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)),
      ),
    ].sort();

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      roles,
      permissions,
    };
  }
}
