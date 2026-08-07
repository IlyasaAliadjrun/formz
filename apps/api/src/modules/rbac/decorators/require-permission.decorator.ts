import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@formz/shared';

export const REQUIRED_PERMISSIONS_KEY = 'formz:requiredPermissions';

/**
 * Mensyaratkan satu atau lebih permission untuk mengakses endpoint.
 *
 * Contoh: `@RequirePermission('form.create')`
 *
 * Kalau diberi lebih dari satu kunci, semuanya harus dimiliki (AND).
 * Tipe `PermissionKey` membuat salah ketik ketahuan saat compile, bukan saat runtime.
 */
export const RequirePermission = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
