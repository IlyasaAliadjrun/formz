import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_EMAIL_SUBJECT,
  DEFAULT_EMAIL_TEMPLATE_ID,
  googleSheetConfigSchema,
  recipientRulesSchema,
  spreadsheetUrl,
  conditionGroupSchema,
  type ConditionGroup,
  type EmailNotificationResult,
  type EmailTemplateId,
  type GoogleSheetConfig,
  type RecipientRules,
  type SheetSyncResult,
} from '@formz/shared';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { QueueService } from '../queue/queue.service';
import {
  SubmissionDispatcherService,
  type DispatchSummary,
} from '../queue/submission-dispatcher.service';
import type {
  TestNotificationDto,
  UpsertGoogleSheetIntegrationDto,
  UpsertNotificationRuleDto,
} from './dto/integrations.dto';

/**
 * Pengaturan integrasi spreadsheet & notifikasi email per form.
 *
 * **Cara autentikasi ke Google: service account, bukan OAuth per pengguna.**
 * Alasannya ditulis lengkap di header `integrations.controller.ts`.
 */

export interface SheetIntegrationView {
  id: string;
  formId: string;
  type: 'google_sheet';
  isActive: boolean;
  config: GoogleSheetConfig;
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationRuleView {
  id: string;
  formId: string;
  name: string | null;
  trigger: string;
  subject: string;
  emailTemplateId: EmailTemplateId;
  condition: ConditionGroup | null;
  recipients: string[];
  recipientFieldIds: string[];
  recipientRules: RecipientRules | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Keadaan kredensial Google di sisi server — dibaca dashboard untuk memandu setup. */
export interface GoogleAccountStatus {
  configured: boolean;
  /** Alamat yang harus diberi akses edit pada spreadsheet tujuan. */
  serviceAccountEmail: string | null;
}

export interface MailStatus {
  configured: boolean;
  provider: string;
  from: string | null;
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly dispatcher: SubmissionDispatcherService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  // -------------------------------------------------------------------------
  // Status kredensial
  // -------------------------------------------------------------------------

  googleAccount(): GoogleAccountStatus {
    const email = this.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null;

    return {
      configured: Boolean(email && this.env.GOOGLE_PRIVATE_KEY),
      // Alamat service account bukan rahasia — justru harus dibagikan ke admin
      // supaya spreadsheet-nya bisa di-share ke sana. Private key-nya tentu tidak.
      serviceAccountEmail: email,
    };
  }

  mailStatus(): MailStatus {
    const provider = this.env.MAIL_PROVIDER;

    return {
      configured: provider === 'console' || Boolean(this.env.SMTP_HOST && this.env.MAIL_FROM),
      provider,
      from: this.env.MAIL_FROM ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Integrasi Google Sheet
  // -------------------------------------------------------------------------

  async listIntegrations(formId: string): Promise<SheetIntegrationView[]> {
    await this.requireForm(formId);

    const rows = await this.prisma.integration.findMany({
      where: { formId, type: 'google_sheet' },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => toIntegrationView(row));
  }

  async createIntegration(
    formId: string,
    body: UpsertGoogleSheetIntegrationDto,
  ): Promise<SheetIntegrationView> {
    await this.requireForm(formId);
    await this.assertNoDuplicateTarget(formId, body.config, null);

    const created = await this.prisma.integration.create({
      data: {
        formId,
        type: 'google_sheet',
        isActive: body.isActive,
        config: body.config as unknown as Prisma.InputJsonValue,
      },
    });

    return toIntegrationView(created);
  }

  async updateIntegration(
    formId: string,
    integrationId: string,
    body: UpsertGoogleSheetIntegrationDto,
  ): Promise<SheetIntegrationView> {
    await this.requireIntegration(formId, integrationId);
    await this.assertNoDuplicateTarget(formId, body.config, integrationId);

    const updated = await this.prisma.integration.update({
      where: { id: integrationId },
      data: {
        isActive: body.isActive,
        config: body.config as unknown as Prisma.InputJsonValue,
      },
    });

    return toIntegrationView(updated);
  }

  /**
   * Menghapus konfigurasinya saja. Baris yang sudah telanjur masuk ke
   * spreadsheet tidak ikut dihapus — data yang sudah ada di dokumen orang lain
   * bukan milik aplikasi ini untuk dihapus.
   */
  async removeIntegration(formId: string, integrationId: string): Promise<{ id: string }> {
    await this.requireIntegration(formId, integrationId);
    await this.prisma.integration.delete({ where: { id: integrationId } });

    return { id: integrationId };
  }

  async testIntegration(formId: string, integrationId: string): Promise<SheetSyncResult> {
    await this.requireIntegration(formId, integrationId);

    if (!this.googleAccount().configured) {
      throw new BadRequestException(
        'Kredensial Google belum diatur di server (GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_PRIVATE_KEY).',
      );
    }

    return this.queue.runSheetSyncTest({
      mode: 'test',
      formId,
      integrationId,
      submissionId: null,
    });
  }

  // -------------------------------------------------------------------------
  // Aturan notifikasi
  // -------------------------------------------------------------------------

  async listNotificationRules(formId: string): Promise<NotificationRuleView[]> {
    await this.requireForm(formId);

    const rows = await this.prisma.notificationRule.findMany({
      where: { formId },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => toRuleView(row));
  }

  async createNotificationRule(
    formId: string,
    body: UpsertNotificationRuleDto,
  ): Promise<NotificationRuleView> {
    await this.requireForm(formId);

    const created = await this.prisma.notificationRule.create({
      data: { formId, ...toRuleData(body) },
    });

    return toRuleView(created);
  }

  async updateNotificationRule(
    formId: string,
    ruleId: string,
    body: UpsertNotificationRuleDto,
  ): Promise<NotificationRuleView> {
    await this.requireRule(formId, ruleId);

    const updated = await this.prisma.notificationRule.update({
      where: { id: ruleId },
      data: toRuleData(body),
    });

    return toRuleView(updated);
  }

  async removeNotificationRule(formId: string, ruleId: string): Promise<{ id: string }> {
    await this.requireRule(formId, ruleId);
    await this.prisma.notificationRule.delete({ where: { id: ruleId } });

    return { id: ruleId };
  }

  async testNotificationRule(
    formId: string,
    ruleId: string,
    body: TestNotificationDto,
  ): Promise<EmailNotificationResult> {
    const rule = await this.requireRule(formId, ruleId);

    if (!this.mailStatus().configured) {
      throw new BadRequestException(
        'Pengiriman email belum diatur di server (SMTP_HOST & MAIL_FROM).',
      );
    }

    // Penerima dinamis baru bisa dihitung dari jawaban sungguhan, dan uji coba
    // memakai jawaban contoh. Jadi yang dipakai di sini hanya alamat tujuan uji
    // coba, atau daftar email tetap milik aturan ini.
    const recipients = body.to ? [body.to] : rule.recipients;

    if (recipients.length === 0) {
      throw new BadRequestException(
        'Aturan ini tidak punya email tetap. Isi alamat tujuan uji coba terlebih dahulu.',
      );
    }

    return this.queue.runEmailNotificationTest({
      mode: 'test',
      formId,
      notificationRuleId: ruleId,
      submissionId: null,
      recipients,
    });
  }

  // -------------------------------------------------------------------------
  // Retry manual
  // -------------------------------------------------------------------------

  /** Mengantre ulang seluruh job untuk satu submission yang gagal diproses. */
  async retrySubmission(submissionId: string): Promise<DispatchSummary> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true },
    });

    if (!submission) throw new NotFoundException('Submission tidak ditemukan');

    return this.dispatcher.redispatch(submissionId);
  }

  // -------------------------------------------------------------------------
  // Helper
  // -------------------------------------------------------------------------

  private async requireForm(formId: string): Promise<{ id: string; title: string }> {
    const form = await this.prisma.form.findUnique({
      where: { id: formId },
      select: { id: true, title: true },
    });

    if (!form) throw new NotFoundException('Form tidak ditemukan');

    return form;
  }

  /**
   * Semua akses ke satu integrasi lewat sini, dan selalu menyertakan `formId`
   * di kondisi pencariannya. Tanpa itu, menebak id integrasi milik form lain
   * cukup untuk mengubahnya lewat URL form yang boleh diakses.
   */
  private async requireIntegration(formId: string, integrationId: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { id: integrationId, formId },
    });

    if (!integration) throw new NotFoundException('Integrasi tidak ditemukan');

    return integration;
  }

  private async requireRule(formId: string, ruleId: string) {
    const rule = await this.prisma.notificationRule.findFirst({ where: { id: ruleId, formId } });

    if (!rule) throw new NotFoundException('Aturan notifikasi tidak ditemukan');

    return rule;
  }

  /**
   * Dua integrasi yang menunjuk spreadsheet **dan** tab yang sama akan menulis
   * dua baris untuk satu submission, dan status di halaman detail jadi ambigu.
   * Menunjuk spreadsheet yang sama dengan tab berbeda tetap boleh.
   */
  private async assertNoDuplicateTarget(
    formId: string,
    config: GoogleSheetConfig,
    exceptId: string | null,
  ): Promise<void> {
    const existing = await this.prisma.integration.findMany({
      where: { formId, type: 'google_sheet', ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { config: true },
    });

    const clash = existing.some((row) => {
      const parsed = googleSheetConfigSchema.safeParse(row.config);

      return (
        parsed.success &&
        parsed.data.spreadsheetId === config.spreadsheetId &&
        parsed.data.sheetName === config.sheetName
      );
    });

    if (clash) {
      throw new BadRequestException(
        `Form ini sudah punya integrasi ke sheet "${config.sheetName}" di spreadsheet yang sama.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pemetaan baris database → bentuk yang dikirim ke dashboard
// ---------------------------------------------------------------------------

interface IntegrationRow {
  id: string;
  formId: string;
  isActive: boolean;
  config: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

function toIntegrationView(row: IntegrationRow): SheetIntegrationView {
  // Baris yang config-nya cacat tetap dikembalikan (dengan nilai default) supaya
  // bisa diperbaiki lewat UI, bukan menghilang dan hanya bisa dihapus lewat SQL.
  const parsed = googleSheetConfigSchema.safeParse(row.config);
  const config = parsed.success
    ? parsed.data
    : googleSheetConfigSchema.parse({ spreadsheetId: '(konfigurasi tidak valid)' });

  return {
    id: row.id,
    formId: row.formId,
    type: 'google_sheet',
    isActive: row.isActive,
    config,
    url: spreadsheetUrl(config.spreadsheetId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface RuleRow {
  id: string;
  formId: string;
  name: string | null;
  trigger: string;
  subject: string | null;
  emailTemplateId: string | null;
  condition: Prisma.JsonValue;
  recipients: string[];
  recipientFieldIds: string[];
  recipientRules: Prisma.JsonValue;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toRuleView(row: RuleRow): NotificationRuleView {
  const condition = conditionGroupSchema.safeParse(row.condition);
  const recipientRules = recipientRulesSchema.safeParse(row.recipientRules);

  return {
    id: row.id,
    formId: row.formId,
    name: row.name,
    trigger: row.trigger,
    subject: row.subject ?? DEFAULT_EMAIL_SUBJECT,
    emailTemplateId: (row.emailTemplateId ?? DEFAULT_EMAIL_TEMPLATE_ID) as EmailTemplateId,
    condition: condition.success ? condition.data : null,
    recipients: row.recipients,
    recipientFieldIds: row.recipientFieldIds,
    recipientRules: recipientRules.success ? recipientRules.data : null,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRuleData(body: UpsertNotificationRuleDto) {
  return {
    name: body.name ?? null,
    trigger: body.trigger,
    subject: body.subject,
    emailTemplateId: body.emailTemplateId,
    condition: (body.condition ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    recipients: body.recipients,
    recipientFieldIds: body.recipientFieldIds,
    recipientRules: (body.recipientRules ?? Prisma.DbNull) as
      Prisma.InputJsonValue | typeof Prisma.DbNull,
    isActive: body.isActive,
  };
}
