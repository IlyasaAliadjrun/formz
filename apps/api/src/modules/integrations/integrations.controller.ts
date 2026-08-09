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
} from '@nestjs/common';
import { EMAIL_TEMPLATES, SHEET_META_COLUMNS } from '@formz/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import {
  testNotificationSchema,
  upsertGoogleSheetIntegrationSchema,
  upsertNotificationRuleSchema,
  type TestNotificationDto,
  type UpsertGoogleSheetIntegrationDto,
  type UpsertNotificationRuleDto,
} from './dto/integrations.dto';
import { IntegrationsService } from './integrations.service';

/**
 * Pengaturan integrasi & notifikasi per form.
 *
 * ## Kenapa service account, bukan OAuth
 *
 * Menghubungkan ke Google Sheets milik pengguna bisa lewat dua jalan, dan yang
 * dipakai di sini adalah **service account**:
 *
 * 1. **OAuth "Login with Google" per pengguna.** Admin menekan tombol, diarahkan
 *    ke halaman izin Google, lalu aplikasi menyimpan refresh token miliknya.
 *    Terlihat lebih rapi, tapi menuntut hal-hal yang tidak cocok untuk aplikasi
 *    self-hosted: setiap pemasang harus mendaftarkan OAuth client sendiri dengan
 *    redirect URI sesuai domainnya, dan karena scope Sheets termasuk sensitif,
 *    aplikasinya harus melewati proses verifikasi Google — kalau tidak, token
 *    pengguna di luar daftar tester kedaluwarsa setiap tujuh hari dan sync
 *    berhenti diam-diam. Di atas itu, refresh token milik orang lain jadi
 *    rahasia jangka panjang yang harus disimpan aplikasi ini, dan sync akan ikut
 *    mati saat karyawan yang menghubungkannya keluar dari perusahaan.
 *
 * 2. **Service account.** Server punya satu identitas sendiri
 *    (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) yang menandatangani JWT dengan private key
 *    dari environment variable, tanpa campur tangan pengguna. Admin cukup
 *    membagikan spreadsheet tujuan ke alamat itu sebagai Editor — persis seperti
 *    membagikannya ke rekan kerja. Tidak ada layar consent, tidak ada proses
 *    verifikasi, tidak ada refresh token orang lain yang perlu disimpan, dan
 *    aksesnya diberikan per dokumen sehingga aplikasi ini tidak pernah bisa
 *    menyentuh berkas Drive lain milik siapa pun.
 *
 * Konsekuensi yang perlu diketahui: baris di spreadsheet tercatat dibuat oleh
 * service account, bukan atas nama admin; dan service account tidak punya kuota
 * Drive sendiri, jadi ia hanya bisa menulis ke spreadsheet yang dibagikan
 * kepadanya — tidak bisa membuat spreadsheet baru. Untuk kasus ini keduanya
 * justru diinginkan.
 *
 * Kredensialnya sendiri tidak pernah masuk database: `integrations.config` hanya
 * menyimpan `credentialRef`, sesuai keputusan Part 1.
 */
@Controller('admin/forms/:formId')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  /**
   * Semua yang dibutuhkan halaman pengaturan dalam satu request: daftar
   * integrasi, aturan notifikasi, keadaan kredensial server, dan pilihan yang
   * tersedia. Tanpa ini dashboard harus menembak lima endpoint untuk merender
   * satu halaman.
   */
  @Get('integration-settings')
  @RequirePermission('integration.manage')
  async settings(@Param('formId', ParseUUIDPipe) formId: string) {
    const [integrations, notificationRules] = await Promise.all([
      this.integrations.listIntegrations(formId),
      this.integrations.listNotificationRules(formId),
    ]);

    return {
      integrations,
      notificationRules,
      google: this.integrations.googleAccount(),
      mail: this.integrations.mailStatus(),
      emailTemplates: EMAIL_TEMPLATES,
      sheetMetaColumns: SHEET_META_COLUMNS,
    };
  }

  // -------------------------------------------------------------------------
  // Integrasi Google Sheet
  // -------------------------------------------------------------------------

  @Get('integrations')
  @RequirePermission('integration.manage')
  listIntegrations(@Param('formId', ParseUUIDPipe) formId: string) {
    return this.integrations.listIntegrations(formId);
  }

  @Post('integrations')
  @RequirePermission('integration.manage')
  @HttpCode(HttpStatus.CREATED)
  createIntegration(
    @Param('formId', ParseUUIDPipe) formId: string,
    @Body(new ZodValidationPipe(upsertGoogleSheetIntegrationSchema))
    body: UpsertGoogleSheetIntegrationDto,
  ) {
    return this.integrations.createIntegration(formId, body);
  }

  @Put('integrations/:integrationId')
  @RequirePermission('integration.manage')
  updateIntegration(
    @Param('formId', ParseUUIDPipe) formId: string,
    @Param('integrationId', ParseUUIDPipe) integrationId: string,
    @Body(new ZodValidationPipe(upsertGoogleSheetIntegrationSchema))
    body: UpsertGoogleSheetIntegrationDto,
  ) {
    return this.integrations.updateIntegration(formId, integrationId, body);
  }

  @Delete('integrations/:integrationId')
  @RequirePermission('integration.manage')
  @HttpCode(HttpStatus.OK)
  removeIntegration(
    @Param('formId', ParseUUIDPipe) formId: string,
    @Param('integrationId', ParseUUIDPipe) integrationId: string,
  ) {
    return this.integrations.removeIntegration(formId, integrationId);
  }

  /** Menulis satu baris contoh ke spreadsheet tujuan, tanpa perlu submission asli. */
  @Post('integrations/:integrationId/test')
  @RequirePermission('integration.manage')
  @HttpCode(HttpStatus.OK)
  testIntegration(
    @Param('formId', ParseUUIDPipe) formId: string,
    @Param('integrationId', ParseUUIDPipe) integrationId: string,
  ) {
    return this.integrations.testIntegration(formId, integrationId);
  }

  // -------------------------------------------------------------------------
  // Aturan notifikasi email
  // -------------------------------------------------------------------------

  @Get('notification-rules')
  @RequirePermission('integration.manage')
  listRules(@Param('formId', ParseUUIDPipe) formId: string) {
    return this.integrations.listNotificationRules(formId);
  }

  @Post('notification-rules')
  @RequirePermission('integration.manage')
  @HttpCode(HttpStatus.CREATED)
  createRule(
    @Param('formId', ParseUUIDPipe) formId: string,
    @Body(new ZodValidationPipe(upsertNotificationRuleSchema)) body: UpsertNotificationRuleDto,
  ) {
    return this.integrations.createNotificationRule(formId, body);
  }

  @Put('notification-rules/:ruleId')
  @RequirePermission('integration.manage')
  updateRule(
    @Param('formId', ParseUUIDPipe) formId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body(new ZodValidationPipe(upsertNotificationRuleSchema)) body: UpsertNotificationRuleDto,
  ) {
    return this.integrations.updateNotificationRule(formId, ruleId, body);
  }

  @Delete('notification-rules/:ruleId')
  @RequirePermission('integration.manage')
  @HttpCode(HttpStatus.OK)
  removeRule(
    @Param('formId', ParseUUIDPipe) formId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ) {
    return this.integrations.removeNotificationRule(formId, ruleId);
  }

  /** Mengirim email contoh memakai template & subjek aturan ini. */
  @Post('notification-rules/:ruleId/test')
  @RequirePermission('integration.manage')
  @HttpCode(HttpStatus.OK)
  testRule(
    @Param('formId', ParseUUIDPipe) formId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body(new ZodValidationPipe(testNotificationSchema)) body: TestNotificationDto,
  ) {
    return this.integrations.testNotificationRule(formId, ruleId, body);
  }
}

/**
 * Retry manual untuk satu submission yang integrasinya gagal.
 *
 * Ditaruh di controller terpisah karena path-nya bukan turunan `/admin/forms/:formId`.
 */
@Controller('admin/submissions/:submissionId')
export class SubmissionIntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Post('integrations/retry')
  @RequirePermission('integration.manage')
  @HttpCode(HttpStatus.OK)
  retry(@Param('submissionId', ParseUUIDPipe) submissionId: string) {
    return this.integrations.retrySubmission(submissionId);
  }
}
