import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Memvalidasi body/query/param memakai schema Zod.
 *
 * Dipilih ketimbang class-validator supaya validasi di API memakai schema yang
 * sama persis dengan yang dipakai form builder dan form renderer lewat
 * @formz/shared — satu definisi, tiga tempat pemakaian.
 *
 * Contoh: `@Body(new ZodValidationPipe(loginSchema)) body: LoginDto`
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: 'Data yang dikirim tidak valid',
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}
