import { z } from 'zod';

/** Role bawaan sistem. Role kustom per organisasi ditambahkan lewat tabel `roles`. */
export const SYSTEM_ROLES = ['super_admin', 'admin', 'editor', 'viewer'] as const;
export const systemRoleSchema = z.enum(SYSTEM_ROLES);
export type SystemRole = z.infer<typeof systemRoleSchema>;

/** Aksi dalam format CASL (lihat ARCHITECTURE.md bagian 3.3). */
export const PERMISSION_ACTIONS = ['manage', 'create', 'read', 'update', 'delete'] as const;
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

export const permissionSchema = z.object({
  action: permissionActionSchema,
  subject: permissionSubjectSchema,
  /** Batasan per-resource, misal hanya form tertentu. */
  conditions: z.record(z.string(), z.unknown()).optional(),
});
export type Permission = z.infer<typeof permissionSchema>;
