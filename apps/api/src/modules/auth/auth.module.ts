import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RbacModule } from '../rbac/rbac.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TokenService } from './token.service';

/**
 * Autentikasi dashboard admin: login, JWT access + refresh token, logout.
 * Endpoint publik (embed) tidak pernah lewat modul ini.
 *
 * Secret sengaja tidak diregistrasikan di JwtModule karena access token dan
 * refresh token memakai secret berbeda — keduanya diberikan per operasi di TokenService.
 */
@Module({
  // forwardRef karena RbacModule juga mengimpor modul ini (RolesService memakai
  // TokenService untuk mencabut sesi saat permission sebuah role berubah).
  imports: [JwtModule.register({}), forwardRef(() => RbacModule)],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtAuthGuard],
  exports: [AuthService, TokenService, JwtAuthGuard],
})
export class AuthModule {}
