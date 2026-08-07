import { z } from 'zod';

const emailField = z.email('Format email tidak valid').transform((v) => v.trim().toLowerCase());
const passwordField = z.string().min(12, 'Password minimal 12 karakter').max(200);
const nameField = z.string().trim().min(1, 'Nama wajib diisi').max(120);

export const createUserSchema = z.object({
  email: emailField,
  password: passwordField,
  name: nameField,
  /** ID role dari tabel `roles`. Boleh lebih dari satu. */
  roleIds: z.array(z.uuid('roleId harus berupa UUID')).default([]),
  isActive: z.boolean().default(true),
});
export type CreateUserDto = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    email: emailField.optional(),
    password: passwordField.optional(),
    name: nameField.optional(),
    /** Kalau diisi, daftar role diganti seluruhnya dengan isi array ini. */
    roleIds: z.array(z.uuid('roleId harus berupa UUID')).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Tidak ada field yang diubah',
  });
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

export const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(25),
  /** Pencarian pada nama atau email. */
  search: z.string().trim().min(1).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});
export type ListUsersDto = z.infer<typeof listUsersSchema>;
