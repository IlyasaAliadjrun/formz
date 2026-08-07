import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@formz/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import {
  createFormSchema,
  embedSettingsSchema,
  listFormsSchema,
  publishFormSchema,
  updateFormSchema,
  type CreateFormDto,
  type EmbedSettingsDto,
  type ListFormsDto,
  type PublishFormDto,
  type UpdateFormDto,
} from './dto/forms.dto';
import { FormsService, type FormDetail, type FormSummary } from './forms.service';

/**
 * CRUD form untuk dashboard admin.
 *
 * Seluruh endpoint di sini berada di bawah /admin sehingga wajib membawa JWT
 * (dijaga JwtAuthGuard global), dan masing-masing menyebut permission-nya sendiri.
 */
@Controller('admin/forms')
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Get()
  @RequirePermission('form.view')
  list(@Query(new ZodValidationPipe(listFormsSchema)) query: ListFormsDto) {
    return this.formsService.list(query);
  }

  @Get(':id')
  @RequirePermission('form.view')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<FormDetail> {
    return this.formsService.findById(id);
  }

  @Post()
  @RequirePermission('form.create')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createFormSchema)) body: CreateFormDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FormDetail> {
    return this.formsService.create(body, user.id);
  }

  /** Menyimpan perubahan draft. Tidak membuat versi baru. */
  @Put(':id')
  @RequirePermission('form.edit')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateFormSchema)) body: UpdateFormDto,
  ): Promise<FormDetail> {
    return this.formsService.update(id, body);
  }

  /** Membekukan draft menjadi versi baru dan menjadikan form bisa diisi publik. */
  @Post(':id/publish')
  @RequirePermission('form.publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(publishFormSchema)) body: PublishFormDto,
  ): Promise<FormDetail> {
    return this.formsService.publish(id, body);
  }

  /** Arsip kalau sudah ada submission, hapus permanen kalau belum. */
  @Delete(':id')
  @RequirePermission('form.delete')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.formsService.remove(id);
  }

  /** Mengatur domain mana saja yang boleh meng-embed form ini. */
  @Put(':id/embed-settings')
  @RequirePermission('form.edit')
  updateEmbedSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(embedSettingsSchema)) body: EmbedSettingsDto,
  ): Promise<FormSummary> {
    return this.formsService.updateEmbedSettings(id, body);
  }
}
