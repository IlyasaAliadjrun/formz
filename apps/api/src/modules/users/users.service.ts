import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SYSTEM_ROLE_NAMES } from '@formz/shared';
import bcrypt from 'bcryptjs';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import type { CreateUserDto, ListUsersDto, UpdateUserDto } from './dto/users.dto';

/** Bentuk user yang dikembalikan API — `passwordHash` tidak pernah ikut keluar. */
const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  roles: { select: { role: { select: { id: true, name: true } } } },
} as const;

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  roles: Array<{ id: string; name: string }>;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async list(query: ListUsersDto): Promise<{
    data: UserResponse[];
    meta: { page: number; perPage: number; total: number; totalPages: number };
  }> {
    const where = {
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: rows.map(toUserResponse),
      meta: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      },
    };
  }

  async findById(id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });

    if (!user) throw new NotFoundException(`User ${id} tidak ditemukan`);

    return toUserResponse(user);
  }

  async create(dto: CreateUserDto): Promise<UserResponse> {
    await this.assertRolesExist(dto.roleIds);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existing) throw new ConflictException(`Email ${dto.email} sudah dipakai`);

    const passwordHash = await bcrypt.hash(dto.password, this.env.BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        isActive: dto.isActive,
        roles: { create: dto.roleIds.map((roleId) => ({ roleId })) },
      },
      select: USER_SELECT,
    });

    this.logger.log(`User dibuat: ${user.email}`);

    return toUserResponse(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponse> {
    const current = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, isActive: true },
    });

    if (!current) throw new NotFoundException(`User ${id} tidak ditemukan`);

    if (dto.roleIds) {
      await this.assertRolesExist(dto.roleIds);
      await this.assertNotLastSuperAdmin(id, dto.roleIds);
    }

    if (dto.isActive === false) {
      await this.assertNotLastSuperAdmin(id, []);
    }

    if (dto.email && dto.email !== current.email) {
      const clash = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      });

      if (clash) throw new ConflictException(`Email ${dto.email} sudah dipakai`);
    }

    const user = await this.prisma.$transaction(async (tx) => {
      if (dto.roleIds) {
        // Daftar role diganti seluruhnya, bukan ditambahkan.
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({ userId: id, roleId })),
          skipDuplicates: true,
        });
      }

      return tx.user.update({
        where: { id },
        data: {
          ...(dto.email ? { email: dto.email } : {}),
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
          ...(dto.password
            ? { passwordHash: await bcrypt.hash(dto.password, this.env.BCRYPT_ROUNDS) }
            : {}),
        },
        select: USER_SELECT,
      });
    });

    // Role, password, atau status aktif berubah → sesi lama tidak boleh dipakai lagi.
    if (dto.roleIds || dto.password || dto.isActive === false) {
      await this.tokenService.revokeAllSessions(id);
      this.logger.log(`Sesi user ${user.email} dicabut karena perubahan akses`);
    }

    return toUserResponse(user);
  }

  async remove(id: string, actingUserId: string): Promise<void> {
    if (id === actingUserId) {
      throw new BadRequestException('Tidak bisa menghapus akun sendiri');
    }

    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });

    if (!user) throw new NotFoundException(`User ${id} tidak ditemukan`);

    await this.assertNotLastSuperAdmin(id, []);

    await this.prisma.user.delete({ where: { id } });
    await this.tokenService.revokeAllSessions(id);

    this.logger.log(`User ${id} dihapus`);
  }

  private async assertRolesExist(roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) return;

    const found = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true },
    });

    if (found.length !== roleIds.length) {
      const foundIds = new Set(found.map((role) => role.id));
      const missing = roleIds.filter((roleId) => !foundIds.has(roleId));
      throw new BadRequestException(`Role tidak ditemukan: ${missing.join(', ')}`);
    }
  }

  /**
   * Mencegah sistem terkunci: harus selalu ada minimal satu Super Admin yang aktif.
   * `nextRoleIds` adalah daftar role user ini setelah perubahan — kosong berarti
   * user-nya akan dihapus atau dinonaktifkan.
   */
  private async assertNotLastSuperAdmin(userId: string, nextRoleIds: string[]): Promise<void> {
    const superAdminRole = await this.prisma.role.findUnique({
      where: { name: SYSTEM_ROLE_NAMES.SUPER_ADMIN },
      select: { id: true },
    });

    if (!superAdminRole) return;

    const isCurrentlySuperAdmin = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId, roleId: superAdminRole.id } },
      select: { userId: true },
    });

    if (!isCurrentlySuperAdmin) return;
    if (nextRoleIds.includes(superAdminRole.id)) return;

    const remaining = await this.prisma.userRole.count({
      where: {
        roleId: superAdminRole.id,
        userId: { not: userId },
        user: { isActive: true },
      },
    });

    if (remaining === 0) {
      throw new BadRequestException(
        'Ini satu-satunya Super Admin yang aktif — tunjuk Super Admin lain dulu sebelum mengubahnya',
      );
    }
  }
}

function toUserResponse(row: {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  roles: Array<{ role: { id: string; name: string } }>;
}): UserResponse {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    roles: row.roles.map(({ role }) => role),
  };
}
