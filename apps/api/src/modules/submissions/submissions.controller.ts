import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import {
  exportSubmissionsSchema,
  listSubmissionsSchema,
  type ExportSubmissionsDto,
  type ListSubmissionsDto,
} from './dto/submissions.dto';
import { SubmissionExportService } from './submission-export.service';
import {
  SubmissionsService,
  type SubmissionDetail,
  type SubmissionListResult,
} from './submissions.service';

/**
 * Pembacaan submission untuk dashboard. Semuanya di bawah /admin sehingga wajib
 * membawa JWT (JwtAuthGuard global), dengan permission per endpoint.
 */
@Controller('admin/submissions')
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly exporter: SubmissionExportService,
  ) {}

  @Get()
  @RequirePermission('submission.view')
  list(
    @Query(new ZodValidationPipe(listSubmissionsSchema)) query: ListSubmissionsDto,
  ): Promise<SubmissionListResult> {
    return this.submissions.list(query);
  }

  /**
   * WAJIB dideklarasikan sebelum `:id`. Express mencocokkan rute sesuai urutan
   * pendaftaran, jadi kalau dibalik, `/export` akan masuk ke handler detail dan
   * ditolak ParseUUIDPipe dengan 400 yang membingungkan.
   *
   * Permission-nya `submission.export`, bukan `submission.view`: mengunduh
   * seluruh jawaban jadi satu berkas adalah kemampuan yang berbeda dari melihat
   * satu per satu di layar.
   */
  @Get('export')
  @RequirePermission('submission.export')
  async export(
    @Query(new ZodValidationPipe(exportSubmissionsSchema)) query: ExportSubmissionsDto,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.exporter.export(query);

    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Length', result.body.length);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    );
    // Nama berkas dibaca dashboard dari header ini; tanpa expose, fetch lintas
    // origin tidak bisa melihatnya sama sekali.
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, X-Export-Rows, X-Export-Truncated',
    );
    response.setHeader('X-Export-Rows', String(result.rowCount));
    response.setHeader('X-Export-Truncated', String(result.truncated));

    response.end(result.body);
  }

  @Get(':id')
  @RequirePermission('submission.view')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SubmissionDetail> {
    return this.submissions.findById(id);
  }
}
