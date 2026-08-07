import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@formz/shared';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request';
import { CaslAbilityFactory } from '../casl-ability.factory';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permission.decorator';

/**
 * Guard otorisasi yang dipasang global setelah JwtAuthGuard.
 *
 * Endpoint tanpa @RequirePermission() dilewatkan — cukup terautentikasi saja
 * (misal GET /admin/auth/me). Endpoint yang punya decorator wajib memenuhi
 * seluruh permission yang disebut (AND).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<PermissionKey[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      // Berarti @RequirePermission dipasang di endpoint @Public — konfigurasi salah.
      throw new ForbiddenException('Endpoint ini butuh autentikasi sebelum cek permission');
    }

    const ability = this.abilityFactory.createForUser(user);
    const missing = required.filter((key) => !this.abilityFactory.hasPermission(ability, key));

    if (missing.length > 0) {
      throw new ForbiddenException(`Butuh permission: ${missing.join(', ')}`);
    }

    return true;
  }
}
