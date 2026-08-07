import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'formz:isPublic';

/**
 * Menandai endpoint yang boleh diakses tanpa JWT.
 *
 * JwtAuthGuard dipasang global, jadi tanpa decorator ini semua endpoint tertutup —
 * termasuk endpoint baru yang lupa dipikirkan aspek autentikasinya (fail closed).
 * Guard menolak decorator ini pada path /admin/*, kecuali endpoint auth itu sendiri.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
