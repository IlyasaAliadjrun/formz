import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  submissionPayloadSchema,
  type PublicForm,
  type SubmissionPayload,
  type SubmissionResult,
} from '@formz/shared';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { formKeySchema } from './dto/public.dto';
import { FormOriginGuard, PARENT_HEADER, header } from './guards/form-origin.guard';
import { FormRateLimitGuard } from './guards/form-rate-limit.guard';
import { PublicFormsService } from './public-forms.service';

/**
 * Dua-satunya endpoint yang boleh disentuh form renderer.
 *
 * Sengaja terpisah dari `/admin/forms`: controller ini tidak punya jalur apa pun
 * ke daftar submission, reporting, atau manajemen user, dan tidak pernah membaca
 * token — form yang dipasang di website orang lain tidak membawa sesi sama sekali
 * (ARCHITECTURE.md bagian 2).
 */
@Controller('public/forms')
@Public()
@UseGuards(FormOriginGuard, FormRateLimitGuard)
export class PublicFormsController {
  constructor(private readonly publicForms: PublicFormsService) {}

  @Get(':formKey/schema')
  getSchema(
    @Param('formKey', new ZodValidationPipe(formKeySchema)) formKey: string,
  ): Promise<PublicForm> {
    return this.publicForms.getPublicForm(formKey);
  }

  // 200, bukan 201: yang dikembalikan adalah pesan sukses untuk pengisi form,
  // bukan lokasi resource baru yang bisa mereka buka.
  @Post(':formKey/submit')
  @HttpCode(200)
  submit(
    @Param('formKey', new ZodValidationPipe(formKeySchema)) formKey: string,
    @Body(new ZodValidationPipe(submissionPayloadSchema)) payload: SubmissionPayload,
    @Req() request: Request,
  ): Promise<SubmissionResult> {
    return this.publicForms.submit(formKey, payload, {
      ipAddress: request.ip ?? null,
      sourceDomain: sourceDomain(request),
      userAgent: header(request, 'user-agent') ?? null,
    });
  }
}

/**
 * Domain website yang memasang form, untuk kolom `submissions.source_domain`.
 * Diambil dari halaman induk kalau ada; kalau form dibuka langsung, dari Origin.
 */
function sourceDomain(request: Request): string | null {
  const candidate = header(request, PARENT_HEADER) ?? header(request, 'origin');

  if (!candidate) return null;

  try {
    return new URL(candidate).host;
  } catch {
    return null;
  }
}
