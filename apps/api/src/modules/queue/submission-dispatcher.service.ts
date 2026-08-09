import { Injectable, Logger } from '@nestjs/common';
import {
  QUEUE_NAMES,
  emailNotificationJobId,
  formSchemaSchema,
  googleSheetConfigSchema,
  recipientRulesSchema,
  resolveRecipients,
  sheetSyncJobId,
  shouldNotify,
  type AnswerMap,
  type FormSchema,
} from '@formz/shared';
import { conditionGroupSchema } from '@formz/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from './queue.service';

/**
 * Menentukan job apa saja yang perlu diantre untuk satu submission, lalu
 * mengantrekannya.
 *
 * Semua keputusan "kirim ke siapa" diambil di sini, bukan di worker. Alasannya
 * satu: hanya di sini seluruh aturan notifikasi sebuah form terlihat sekaligus,
 * jadi hanya di sini satu alamat email bisa dipastikan tidak dikirimi dua kali
 * ketika sebuah submission kebetulan cocok dengan dua aturan.
 */

export interface DispatchSummary {
  sheetJobs: number;
  emailJobs: number;
  /** Alasan kenapa sebuah target dilewati — muncul di respons tombol retry. */
  skipped: string[];
}

@Injectable()
export class SubmissionDispatcherService {
  private readonly logger = new Logger(SubmissionDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Dipanggil tepat setelah submission tersimpan.
   *
   * Kegagalan mengantre **tidak** dilempar ke pemanggil: submission-nya sudah
   * masuk database, dan membuat pengisi form melihat error karena Redis
   * bermasalah akan menukar kegagalan yang bisa diperbaiki belakangan (job
   * diulang manual) dengan kegagalan yang tidak bisa diperbaiki sama sekali
   * (orangnya sudah pergi).
   */
  async dispatchQuietly(input: {
    formId: string;
    submissionId: string;
    schema: FormSchema;
    answers: AnswerMap;
  }): Promise<void> {
    try {
      const summary = await this.dispatch(input);

      if (summary.sheetJobs + summary.emailJobs > 0) {
        this.logger.log(
          `Submission ${input.submissionId}: ${summary.sheetJobs} job sheet, ${summary.emailJobs} job email diantre`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Gagal mengantre job untuk submission ${input.submissionId}: ${describe(error)} — ` +
          'jalankan ulang lewat tombol retry di halaman detail submission',
      );
    }
  }

  async dispatch(input: {
    formId: string;
    submissionId: string;
    schema: FormSchema;
    answers: AnswerMap;
    /** Bersihkan job lama dengan id yang sama lebih dulu (dipakai retry manual). */
    replaceExisting?: boolean;
  }): Promise<DispatchSummary> {
    const [integrations, rules] = await Promise.all([
      this.prisma.integration.findMany({
        where: { formId: input.formId, isActive: true, type: 'google_sheet' },
        select: { id: true, config: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.notificationRule.findMany({
        where: { formId: input.formId, isActive: true },
        select: {
          id: true,
          name: true,
          condition: true,
          recipients: true,
          recipientFieldIds: true,
          recipientRules: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const summary: DispatchSummary = { sheetJobs: 0, emailJobs: 0, skipped: [] };

    for (const integration of integrations) {
      const config = googleSheetConfigSchema.safeParse(integration.config);

      if (!config.success) {
        summary.skipped.push(`Integrasi ${integration.id}: konfigurasi tidak valid`);
        this.logger.warn(
          `Integrasi ${integration.id} dilewati — config tidak lolos validasi: ${config.error.message}`,
        );
        continue;
      }

      if (input.replaceExisting) {
        await this.queue.forget(
          QUEUE_NAMES.SHEET_SYNC,
          sheetSyncJobId(input.submissionId, integration.id),
        );
      }

      await this.queue.enqueueSheetSync({
        mode: 'live',
        formId: input.formId,
        integrationId: integration.id,
        submissionId: input.submissionId,
      });
      summary.sheetJobs += 1;
    }

    // Satu alamat hanya boleh dapat satu email per submission. Aturan yang
    // terdaftar lebih dulu yang memenangkan alamat tersebut.
    const claimed = new Set<string>();

    for (const rule of rules) {
      const label = rule.name ?? rule.id;
      const condition = parseCondition(rule.condition);

      if (!shouldNotify(condition, input.schema, input.answers)) {
        summary.skipped.push(`Notifikasi "${label}": kondisi tidak terpenuhi`);
        continue;
      }

      const recipients = resolveRecipients(
        {
          recipients: rule.recipients,
          recipientFieldIds: rule.recipientFieldIds,
          recipientRules: parseRecipientRules(rule.recipientRules),
        },
        input.schema,
        input.answers,
      ).filter((email) => !claimed.has(email));

      if (recipients.length === 0) {
        summary.skipped.push(`Notifikasi "${label}": tidak ada penerima`);
        continue;
      }

      for (const email of recipients) claimed.add(email);

      if (input.replaceExisting) {
        await this.queue.forget(
          QUEUE_NAMES.EMAIL_NOTIFICATION,
          emailNotificationJobId(input.submissionId, rule.id),
        );
      }

      await this.queue.enqueueEmailNotification({
        mode: 'live',
        formId: input.formId,
        notificationRuleId: rule.id,
        submissionId: input.submissionId,
        recipients,
      });
      summary.emailJobs += 1;
    }

    return summary;
  }

  /**
   * Mengantre ulang seluruh job untuk satu submission yang sudah tersimpan.
   * Dipakai tombol retry manual di dashboard saat sebuah sync atau email gagal.
   */
  async redispatch(submissionId: string): Promise<DispatchSummary> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        formId: true,
        answers: true,
        formVersion: { select: { schema: true } },
      },
    });

    if (!submission) {
      throw new Error(`Submission ${submissionId} tidak ditemukan`);
    }

    const schema = formSchemaSchema.parse(submission.formVersion.schema);

    return this.dispatch({
      formId: submission.formId,
      submissionId: submission.id,
      schema,
      answers: (submission.answers ?? {}) as AnswerMap,
      replaceExisting: true,
    });
  }
}

/**
 * Kondisi dan aturan penerima dibaca dari JSONB, jadi bentuknya tidak dijamin
 * database. Yang tidak lolos parse diperlakukan sebagai "tanpa kondisi" /
 * "tanpa aturan tambahan" alih-alih menggagalkan seluruh pengiriman.
 */
function parseCondition(value: unknown) {
  if (value === null || value === undefined) return null;

  const parsed = conditionGroupSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function parseRecipientRules(value: unknown) {
  if (value === null || value === undefined) return null;

  const parsed = recipientRulesSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
