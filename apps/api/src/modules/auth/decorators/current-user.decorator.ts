import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '@formz/shared';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/** Mengambil user yang sudah diverifikasi JwtAuthGuard dari request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      // Hanya terjadi kalau decorator dipakai di endpoint @Public — bug pemrograman.
      throw new Error('CurrentUser dipakai pada endpoint yang tidak melewati JwtAuthGuard');
    }

    return request.user;
  },
);
