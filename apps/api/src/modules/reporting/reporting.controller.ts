import { Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { ReportOverview } from '@formz/shared';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { QueueService } from '../queue/queue.service';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import {
  exportReportSchema,
  reportOverviewSchema,
  type ExportReportDto,
  type ReportOverviewDto,
} from './dto/reports.dto';
import { ReportExportService } from './report-export.service';
import { ReportingService } from './reporting.service';

/**
 * Laporan per form. Semuanya di bawah /admin sehingga wajib membawa JWT
 * (JwtAuthGuard global), dengan `report.view` sebagai permission-nya.
 *
 * ## Kenapa ekspor di sini tidak memakai permission terpisah
 *
 * `/admin/submissions/export` sengaja dipisah dari `submission.view` di Part 6,
 * karena mengunduh seluruh jawaban jadi satu berkas yang bisa dikirim ke mana
 * saja memang kemampuan yang berbeda dari membacanya satu per satu. Di sini
 * bedanya tidak ada: berkas laporan hanya berisi angka agregat yang sudah
 * tampil utuh di layar bagi siapa pun yang punya `report.view`. Permission
 * terpisah untuk mengunduh angka yang sama hanya menambah satu centang yang
 * tidak membatasi apa pun.
 */
@Controller('admin/reports')
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly exporter: ReportExportService,
    private readonly queue: QueueService,
  ) {}

  @Get('overview')
  @RequirePermission('report.view')
  overview(
    @Query(new ZodValidationPipe(reportOverviewSchema)) query: ReportOverviewDto,
  ): Promise<ReportOverview> {
    return this.reporting.overview(query);
  }

  @Get('export')
  @RequirePermission('report.view')
  async export(
    @Query(new ZodValidationPipe(exportReportSchema)) query: ExportReportDto,
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
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    response.end(result.body);
  }

  /**
   * Meminta agregasi dihitung ulang sekarang, tanpa menunggu jadwal.
   *
   * Ada karena tanpa ini halaman laporan punya satu keadaan yang membingungkan:
   * form yang baru saja menerima kiriman tampil dengan angka nol, dan tidak ada
   * yang bisa dilakukan pembacanya selain menunggu tanpa tahu berapa lama.
   *
   * Permission-nya `report.view`, sama dengan endpoint lain di sini — yang
   * dilakukan tombol ini hanyalah mempercepat perhitungan yang toh akan
   * berjalan sendiri. Penyalahgunaannya juga terbatas dengan sendirinya:
   * permintaan yang datang selagi refresh sebelumnya masih antre digabung ke
   * job yang sama (lihat `QueueService.requestReportRefresh`).
   */
  @Post('refresh')
  @HttpCode(202)
  @RequirePermission('report.view')
  async refresh(): Promise<{ queued: boolean; message: string }> {
    const queued = await this.queue.requestReportRefresh();

    return {
      queued,
      message: queued
        ? 'Perhitungan ulang diantrekan. Muat ulang halaman ini sebentar lagi.'
        : 'Perhitungan ulang sudah berjalan — permintaan ini digabung ke sana.',
    };
  }
}
