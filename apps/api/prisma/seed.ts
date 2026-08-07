import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client';
import { requireDatabaseUrl } from './database-url';

loadDotenv({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
  quiet: true,
});

/**
 * Seed idempotent — aman dijalankan berulang kali (dipakai upsert, bukan create).
 * Dijalankan otomatis oleh service `db-setup` di docker-compose setiap stack naik.
 */

const BCRYPT_ROUNDS = 12;

/** Daftar permission dasar. `key` memakai format `resource.action` supaya cocok dengan CASL. */
const PERMISSIONS: Array<{ key: string; description: string }> = [
  { key: 'form.create', description: 'Membuat form baru' },
  { key: 'form.edit', description: 'Mengubah form dan schema-nya' },
  { key: 'form.delete', description: 'Menghapus atau mengarsipkan form' },
  { key: 'form.publish', description: 'Mempublish form sehingga bisa diisi publik' },
  { key: 'submission.view', description: 'Melihat daftar dan detail submission' },
  { key: 'submission.export', description: 'Mengekspor submission ke xlsx/csv' },
  { key: 'report.view', description: 'Melihat halaman reporting' },
  { key: 'user.manage', description: 'Mengelola user, role, dan permission' },
];

const ALL_PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);

/** Role bawaan sistem beserta permission-nya. */
const ROLES: Array<{ name: string; description: string; permissionKeys: string[] }> = [
  {
    name: 'Super Admin',
    description: 'Akses penuh ke seluruh fitur, termasuk manajemen user dan role',
    permissionKeys: ALL_PERMISSION_KEYS,
  },
  {
    name: 'Form Manager',
    description: 'Mengelola form dan submission, tanpa akses manajemen user',
    permissionKeys: [
      'form.create',
      'form.edit',
      'form.delete',
      'form.publish',
      'submission.view',
      'submission.export',
      'report.view',
    ],
  },
  {
    name: 'Viewer',
    description: 'Hanya bisa melihat submission dan laporan',
    permissionKeys: ['submission.view', 'report.view'],
  },
];

const SUPER_ADMIN_ROLE = 'Super Admin';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireDatabaseUrl() }),
});

async function seedPermissions(): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();

  for (const permission of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
    byKey.set(row.key, row.id);
  }

  console.info(`✓ ${PERMISSIONS.length} permission tersinkron`);
  return byKey;
}

async function seedRoles(permissionIdByKey: Map<string, string>): Promise<Map<string, string>> {
  const byName = new Map<string, string>();

  for (const role of ROLES) {
    const row = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description, isSystem: true },
      create: { name: role.name, description: role.description, isSystem: true },
    });
    byName.set(row.name, row.id);

    const permissionIds = role.permissionKeys.map((key) => {
      const id = permissionIdByKey.get(key);
      if (!id) throw new Error(`Permission "${key}" tidak ditemukan untuk role "${role.name}"`);
      return id;
    });

    // Tambahkan permission yang belum ada, lalu buang yang sudah tidak dipakai lagi —
    // supaya perubahan daftar permission di atas ikut tercermin saat seed diulang.
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: row.id, permissionId })),
      skipDuplicates: true,
    });

    await prisma.rolePermission.deleteMany({
      where: { roleId: row.id, permissionId: { notIn: permissionIds } },
    });

    console.info(`✓ Role "${role.name}" — ${permissionIds.length} permission`);
  }

  return byName;
}

async function seedAdminUser(roleIdByName: Map<string, string>): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Super Admin';

  if (!email || !password) {
    console.warn(
      '\n⚠ ADMIN_EMAIL / ADMIN_PASSWORD belum diisi di .env — user admin default dilewati.' +
        '\n  Isi keduanya lalu jalankan ulang: docker compose run --rm db-setup\n',
    );
    return;
  }

  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD minimal 12 karakter.');
  }

  const roleId = roleIdByName.get(SUPER_ADMIN_ROLE);
  if (!roleId) throw new Error(`Role "${SUPER_ADMIN_ROLE}" tidak ditemukan`);

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Password hanya diisi saat user pertama kali dibuat. Kalau user-nya sudah ada,
  // password yang mungkin sudah diganti admin tidak ditimpa balik oleh nilai .env.
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, isActive: true },
    create: { email, name, passwordHash, isActive: true },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId } },
    update: {},
    create: { userId: user.id, roleId },
  });

  console.info(`✓ User admin "${email}" siap dengan role ${SUPER_ADMIN_ROLE}`);
}

async function main(): Promise<void> {
  console.info('Menjalankan seed...');

  const permissionIdByKey = await seedPermissions();
  const roleIdByName = await seedRoles(permissionIdByKey);
  await seedAdminUser(roleIdByName);

  console.info('Seed selesai.');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Seed gagal: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
