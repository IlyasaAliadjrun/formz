import { permissionKeySchema } from '@formz/shared';
import { z } from 'zod';

/**
 * Bentuk yang diterima endpoint /admin/roles.
 *
 * `permissionKeys` divalidasi terhadap katalog di `@formz/shared`, bukan terhadap
 * isi tabel `permissions`. Keduanya memang selalu sama karena seed menyalin dari
 * katalog itu — tapi memvalidasi di sisi Zod membuat kunci yang tidak dikenal
 * ditolak 400 dengan pesan jelas, bukan lolos sampai query lalu gagal di sana.
 */

const roleNameSchema = z
  .string()
  .trim()
  .min(1, 'Nama role wajib diisi')
  .max(60, 'Nama role maksimal 60 karakter');

export const createRoleSchema = z.object({
  name: roleNameSchema,
  description: z.string().trim().max(255).optional(),
  permissionKeys: z.array(permissionKeySchema).max(50).prefault([]),
});
export type CreateRoleDto = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: roleNameSchema.optional(),
    description: z.string().trim().max(255).nullable().optional(),
    /** Kalau diisi, daftar permission diganti seluruhnya dengan isi array ini. */
    permissionKeys: z.array(permissionKeySchema).max(50).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Tidak ada perubahan yang dikirim' });
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;

export const listRolesSchema = z
  .object({
    /** Pencarian pada nama role. */
    search: z.string().trim().min(1).max(60).optional(),
  })
  .prefault({});
export type ListRolesDto = z.infer<typeof listRolesSchema>;
