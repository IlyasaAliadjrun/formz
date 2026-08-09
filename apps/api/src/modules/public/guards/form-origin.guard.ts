import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { isOriginAllowed, isParentAllowed } from '../origin-policy';
import { PublicFormsService } from '../public-forms.service';

/** Header tempat renderer melaporkan URL halaman yang memasangnya. */
export const PARENT_HEADER = 'x-formz-parent';

/**
 * Menegakkan whitelist domain di sisi server.
 *
 * Header CORS yang disusun di `main.ts` hanya membuat **browser** menolak
 * membaca respons; request-nya sendiri tetap sampai dan tetap dilayani. Guard
 * inilah yang benar-benar menolaknya, sehingga form yang whitelist-nya diisi
 * tidak bisa dipakai dari domain lain lewat halaman web mana pun.
 */
@Injectable()
export class FormOriginGuard implements CanActivate {
  private readonly logger = new Logger(FormOriginGuard.name);

  constructor(private readonly publicForms: PublicFormsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const formKey = readFormKey(request);

    if (!formKey) return true;

    const policy = await this.publicForms.originPolicy(formKey);

    // formKey tidak dikenal: biarkan lewat supaya controller yang menjawab 404,
    // alih-alih 403 di sini yang justru membocorkan bahwa form itu tidak ada.
    if (!policy) return true;

    const origin = header(request, 'origin');
    const parent = header(request, PARENT_HEADER);

    if (!isOriginAllowed(origin, policy)) {
      this.logger.warn(`Origin ${origin} ditolak untuk form ${formKey}`);
      throw new ForbiddenException('Domain ini tidak diizinkan mengakses form tersebut');
    }

    if (!isParentAllowed(parent, policy)) {
      this.logger.warn(`Halaman induk ${parent} ditolak untuk form ${formKey}`);
      throw new ForbiddenException('Form ini tidak diizinkan dipasang di domain tersebut');
    }

    return true;
  }
}

export function readFormKey(request: Request): string | null {
  const value = (request.params as Record<string, string | undefined>).formKey;

  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  const single = Array.isArray(value) ? value[0] : value;

  return single && single.length > 0 ? single : undefined;
}
