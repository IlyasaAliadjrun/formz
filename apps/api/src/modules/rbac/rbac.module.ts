import { Global, Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaslAbilityFactory } from './casl-ability.factory';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { UserPermissionsService } from './user-permissions.service';

/**
 * Role Based Access Control berbasis CASL.
 *
 * Global karena guard-nya dipasang app-wide di AppModule dan modul fitur mana pun
 * boleh menyuntik CaslAbilityFactory untuk cek per-resource yang lebih detail.
 */
@Global()
@Module({
  // forwardRef: AuthModule butuh UserPermissionsService dari sini untuk guard-nya,
  // sementara RolesService butuh TokenService dari sana untuk mencabut sesi.
  imports: [forwardRef(() => AuthModule)],
  controllers: [RolesController],
  providers: [CaslAbilityFactory, UserPermissionsService, PermissionsGuard, RolesService],
  exports: [CaslAbilityFactory, UserPermissionsService, PermissionsGuard, RolesService],
})
export class RbacModule {}
