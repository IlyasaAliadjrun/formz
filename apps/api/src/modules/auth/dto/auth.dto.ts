import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('Format email tidak valid').transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1, 'Password wajib diisi'),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken wajib diisi'),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

/** Logout memakai bentuk yang sama dengan refresh: token yang mau dicabut. */
export const logoutSchema = refreshSchema;
export type LogoutDto = RefreshDto;
