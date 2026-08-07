import { z } from 'zod';

/**
 * Katalog permission — satu sumber kebenaran untuk seluruh sistem.
 *
 * Dipakai oleh:
 * - `apps/api/prisma/seed.ts` untuk mengisi tabel `permissions` & `role_permissions`
 * - `CaslAbilityFactory` di apps/api untuk menerjemahkan permission user jadi ability CASL
 * - dashboard, untuk menyembunyikan menu yang tidak boleh diakses
 *
 * `key` memakai format `resource.action` dan disimpan apa adanya di kolom
 * `permissions.key`. Pasangan (`action`, `subject`) adalah bentuk CASL-nya.
 */

/** Aksi dalam format CASL (lihat ARCHITECTURE.md bagian 3.3). */
export const PERMISSION_ACTIONS = [
  'manage',
  'create',
  'read',
  'update',
  'delete',
  'export',
] as const;
export const permissionActionSchema = z.enum(PERMISSION_ACTIONS);
export type PermissionAction = z.infer<typeof permissionActionSchema>;

export const PERMISSION_SUBJECTS = [
  'all',
  'Form',
  'Submission',
  'Report',
  'User',
  'Role',
  'Integration',
] as const;
export const permissionSubjectSchema = z.enum(PERMISSION_SUBJECTS);
export type PermissionSubject = z.infer<typeof permissionSubjectSchema>;

export interface PermissionDefinition {
  key: string;
  action: PermissionAction;
  subject: PermissionSubject;
  description: string;
}

export const PERMISSIONS = [
  {
    key: 'form.create',
    action: 'create',
    subject: 'Form',
    description: 'Membuat form baru',
  },
  {
    key: 'form.edit',
    action: 'update',
    subject: 'Form',
    description: 'Mengubah form dan schema-nya',
  },
  {
    key: 'form.delete',
    action: 'delete',
    subject: 'Form',
    description: 'Menghapus atau mengarsipkan form',
  },
  {
    key: 'form.publish',
    action: 'manage',
    subject: 'Form',
    description: 'Mempublish form sehingga bisa diisi publik',
  },
  {
    key: 'submission.view',
    action: 'read',
    subject: 'Submission',
    description: 'Melihat daftar dan detail submission',
  },
  {
    key: 'submission.export',
    action: 'export',
    subject: 'Submission',
    description: 'Mengekspor submission ke xlsx/csv',
  },
  {
    key: 'report.view',
    action: 'read',
    subject: 'Report',
    description: 'Melihat halaman reporting',
  },
  {
    key: 'user.manage',
    action: 'manage',
    subject: 'User',
    description: 'Mengelola user, role, dan permission',
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key) as PermissionKey[];

export const permissionKeySchema = z.enum(PERMISSION_KEYS as [PermissionKey, ...PermissionKey[]]);

const PERMISSION_BY_KEY = new Map<string, PermissionDefinition>(
  PERMISSIONS.map((permission) => [permission.key, permission]),
);

/** Menerjemahkan `form.create` menjadi `{ action: 'create', subject: 'Form' }`. */
export function findPermission(key: string): PermissionDefinition | undefined {
  return PERMISSION_BY_KEY.get(key);
}

export function isPermissionKey(key: string): key is PermissionKey {
  return PERMISSION_BY_KEY.has(key);
}

/**
 * Role bawaan sistem. Nama-nya dipakai apa adanya di kolom `roles.name`,
 * karena itu yang tampil di UI.
 */
export const SYSTEM_ROLE_NAMES = {
  SUPER_ADMIN: 'Super Admin',
  FORM_MANAGER: 'Form Manager',
  VIEWER: 'Viewer',
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[keyof typeof SYSTEM_ROLE_NAMES];

export interface RoleDefinition {
  name: SystemRoleName;
  description: string;
  permissionKeys: readonly PermissionKey[];
}

export const SYSTEM_ROLES: readonly RoleDefinition[] = [
  {
    name: SYSTEM_ROLE_NAMES.SUPER_ADMIN,
    description: 'Akses penuh ke seluruh fitur, termasuk manajemen user dan role',
    permissionKeys: PERMISSION_KEYS,
  },
  {
    name: SYSTEM_ROLE_NAMES.FORM_MANAGER,
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
    name: SYSTEM_ROLE_NAMES.VIEWER,
    description: 'Hanya bisa melihat submission dan laporan',
    permissionKeys: ['submission.view', 'report.view'],
  },
];

/** Bentuk yang dikembalikan `GET /admin/auth/me`. */
export const authenticatedUserSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  isActive: z.boolean(),
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
  permissions: z.array(z.string()),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  /** Masa berlaku access token dalam detik. */
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;
