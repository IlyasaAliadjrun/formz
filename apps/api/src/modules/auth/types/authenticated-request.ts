import type { AuthenticatedUser } from '@formz/shared';
import type { Request } from 'express';

/** Request yang sudah dilewati JwtAuthGuard dan membawa user terverifikasi. */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
