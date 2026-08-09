import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PermissionKey } from '@formz/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import type { CreateRoleDto, ListRolesDto, UpdateRoleDto } from './dto/roles.dto';

/**
 * Pengelolaan role dan permission-nya.
 *
 * ## Role bawaan tidak bisa diubah dari sini
 *
 * `prisma/seed.ts` menyalin daftar permission setiap role bawaan dari
 * `SYSTEM_ROLES` di `@formz/shared` — termasuk **membuang** permission yang tidak
 * ada di daftar itu. Seed jalan otomatis setiap `docker compose up`, jadi
 * perubahan permission role bawaan lewat API akan hilang diam-diam pada restart
 * berikutnya. Perubahan yang tidak bertahan lebih buruk daripada perubahan yang
 * ditolak, jadi role bawaan dikunci di sini dan yang butuh kombinasi lain membuat
 * role baru.
 */

export interface RoleResponse {
  id: string;
  name: string;
  description: string | null;
  /** Role bawaan sistem: tidak bisa diubah maupun dihapus. */
  isSystem: boolean;
  permissionKeys: string[];
  /** Berapa user yang memegang role ini — dipakai UI sebelum menghapus. */
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  createdAt: true,
  updatedAt: true,
  permissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { users: true } },
} as const;

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async list(query: ListRolesDto): Promise<{ data: RoleResponse[] }> {
    const roles = await this.prisma.role.findMany({
      where: query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {},
      select: ROLE_SELECT,
      // Role bawaan di atas: itu yang paling sering jadi acuan saat menyusun
      // role baru, dan jumlahnya tetap.
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });

    return { data: roles.map(toRoleResponse) };
  }

  async findById(id: string): Promise<RoleResponse> {
    const role = await this.prisma.role.findUnique({ where: { id }, select: ROLE_SELECT });

    if (!role) throw new NotFoundException(`Role ${id} tidak ditemukan`);

    return toRoleResponse(role);
  }

  async create(dto: CreateRoleDto): Promise<RoleResponse> {
    await this.assertNameAvailable(dto.name, null);

    const permissionIds = await this.resolvePermissionIds(dto.permissionKeys);

    const role = await this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        isSystem: false,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      select: ROLE_SELECT,
    });

    this.logger.log(`Role dibuat: ${role.name} (${dto.permissionKeys.length} permission)`);

    return toRoleResponse(role);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleResponse> {
    const current = await this.requireEditableRole(id);

    if (dto.name && dto.name !== current.name) {
      await this.assertNameAvailable(dto.name, id);
    }

    const permissionIds = dto.permissionKeys
      ? await this.resolvePermissionIds(dto.permissionKeys)
      : null;

    const role = await this.prisma.$transaction(async (tx) => {
      if (permissionIds) {
        // Daftar permission diganti seluruhnya, bukan ditambahkan.
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
          skipDuplicates: true,
        });
      }

      return tx.role.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.description === undefined ? {} : { description: dto.description }),
        },
        select: ROLE_SELECT,
      });
    });

    // Permission dibaca dari database tiap request (keputusan Part 2), jadi hak
    // akses yang baru sebenarnya sudah berlaku seketika. Sesi tetap dicabut
    // supaya menu di dashboard ikut tersusun ulang — `GET /admin/auth/me`
    // di-cache klien, dan tanpa login ulang orangnya akan melihat menu lama
    // yang tombolnya menghasilkan 403.
    if (permissionIds) {
      const holders = await this.prisma.userRole.findMany({
        where: { roleId: id },
        select: { userId: true },
      });

      await Promise.all(holders.map(({ userId }) => this.tokenService.revokeAllSessions(userId)));

      if (holders.length > 0) {
        this.logger.log(
          `Sesi ${holders.length} user dicabut karena permission role ${role.name} berubah`,
        );
      }
    }

    return toRoleResponse(role);
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.requireEditableRole(id);

    const holders = await this.prisma.userRole.count({ where: { roleId: id } });

    if (holders > 0) {
      // Menghapus baris user_roles otomatis akan mencabut akses orang tanpa
      // mereka tahu kenapa. Lebih baik ditolak dengan sebutan jumlahnya.
      throw new BadRequestException(
        `Role ini masih dipakai ${holders} user. Pindahkan mereka ke role lain dulu.`,
      );
    }

    await this.prisma.role.delete({ where: { id } });
    this.logger.log(`Role ${id} dihapus`);

    return { id };
  }

  // -------------------------------------------------------------------------
  // Helper
  // -------------------------------------------------------------------------

  private async requireEditableRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: { id: true, name: true, isSystem: true },
    });

    if (!role) throw new NotFoundException(`Role ${id} tidak ditemukan`);

    if (role.isSystem) {
      throw new BadRequestException(
        `"${role.name}" adalah role bawaan sistem dan tidak bisa diubah — ` +
          'permission-nya disetel ulang dari kode setiap seed dijalankan. ' +
          'Buat role baru kalau butuh kombinasi permission yang lain.',
      );
    }

    return role;
  }

  private async assertNameAvailable(name: string, exceptId: string | null): Promise<void> {
    const existing = await this.prisma.role.findUnique({ where: { name }, select: { id: true } });

    if (existing && existing.id !== exceptId) {
      throw new ConflictException(`Role bernama "${name}" sudah ada`);
    }
  }

  /**
   * Menerjemahkan kunci permission menjadi id barisnya di database.
   *
   * Kunci yang tidak ada barisnya berarti database belum di-seed ulang setelah
   * katalog di `@formz/shared` bertambah — kondisi yang perlu diperbaiki dengan
   * menjalankan seed, bukan didiamkan dengan menyimpan role tanpa permission itu.
   */
  private async resolvePermissionIds(keys: PermissionKey[]): Promise<string[]> {
    if (keys.length === 0) return [];

    const unique = [...new Set(keys)];
    const rows = await this.prisma.permission.findMany({
      where: { key: { in: unique } },
      select: { id: true, key: true },
    });

    if (rows.length !== unique.length) {
      const found = new Set(rows.map((row) => row.key));
      const missing = unique.filter((key) => !found.has(key));

      throw new BadRequestException(
        `Permission belum ada di database: ${missing.join(', ')}. ` +
          'Jalankan `docker compose run --rm db-setup` untuk menyinkronkan katalog permission.',
      );
    }

    return rows.map((row) => row.id);
  }
}

function toRoleResponse(row: {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: Array<{ permission: { key: string } }>;
  _count: { users: number };
}): RoleResponse {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    permissionKeys: row.permissions.map(({ permission }) => permission.key).sort(),
    userCount: row._count.users,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
