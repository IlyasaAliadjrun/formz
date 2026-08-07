import { Global, Module } from '@nestjs/common';
import { CaslAbilityFactory } from './casl-ability.factory';
import { PermissionsGuard } from './guards/permissions.guard';
import { UserPermissionsService } from './user-permissions.service';

/**
 * Role Based Access Control berbasis CASL.
 *
 * Global karena guard-nya dipasang app-wide di AppModule dan modul fitur mana pun
 * boleh menyuntik CaslAbilityFactory untuk cek per-resource yang lebih detail.
 */
@Global()
@Module({
  providers: [CaslAbilityFactory, UserPermissionsService, PermissionsGuard],
  exports: [CaslAbilityFactory, UserPermissionsService, PermissionsGuard],
})
export class RbacModule {}
