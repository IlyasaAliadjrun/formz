import { Injectable } from '@nestjs/common';
import {
  findPermission,
  SYSTEM_ROLE_NAMES,
  type AuthenticatedUser,
  type PermissionAction,
  type PermissionSubject,
} from '@formz/shared';
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';

export type AppAbility = MongoAbility<[PermissionAction, PermissionSubject]>;

/**
 * Menerjemahkan permission user (baris `role_permissions` di database) menjadi
 * ability CASL.
 *
 * Kunci permission berformat `resource.action`, misal `form.create`. Bentuk CASL-nya
 * (`create` pada subject `Form`) diambil dari katalog di @formz/shared, jadi
 * penerjemahan ini tidak pernah menebak-nebak.
 */
@Injectable()
export class CaslAbilityFactory {
  createForUser(user: AuthenticatedUser): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    // User nonaktif tidak mendapat ability apa pun, sekalipun role-nya masih menempel.
    if (!user.isActive) {
      return build();
    }

    const isSuperAdmin = user.roles.some((role) => role.name === SYSTEM_ROLE_NAMES.SUPER_ADMIN);

    if (isSuperAdmin) {
      // `manage all` adalah wildcard CASL: semua aksi pada semua subject.
      can('manage', 'all');
      return build();
    }

    for (const key of user.permissions) {
      const permission = findPermission(key);

      // Kunci yang tidak dikenal (misal sisa dari versi lama) sengaja diabaikan,
      // bukan dianggap mengizinkan sesuatu.
      if (!permission) continue;

      can(permission.action, permission.subject);
    }

    return build();
  }

  /** Cek satu kunci permission, dipakai oleh PermissionsGuard. */
  hasPermission(ability: AppAbility, key: string): boolean {
    const permission = findPermission(key);
    if (!permission) return false;

    return ability.can(permission.action, permission.subject);
  }
}
