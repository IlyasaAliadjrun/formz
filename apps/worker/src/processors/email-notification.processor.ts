import {
  DEFAULT_EMAIL_SUBJECT,
  DEFAULT_EMAIL_TEMPLATE_ID,
  describeAnswers,
  emailNotificationJobSchema,
  renderTemplateString,
  type EmailDeliveryResult,
  type EmailNotificationJob,
  type EmailNotificationResult,
} from '@formz/shared';
import { render } from '@react-email/render';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  beginLog,
  loadFormContext,
  loadNotificationRule,
  loadSubmissionContext,
  markLogFailed,
  markLogSuccess,
  type SubmissionContext,
} from '../db/queries';
import { SubmissionNotification } from '../emails/submission-notification';
import { env } from '../env';
import { createLogger } from '../logger';
import { mailProvider } from '../mail';
import { buildSampleSubmission, isSampleSubmission } from '../sample-submission';

const logger = createLogger('email-notification');

/**
 * Mengirim notifikasi submission ke daftar penerima yang sudah dihitung API.
 *
 * Setiap penerima dikirimi email terpisah dan punya baris log sendiri. Alasannya
 * dua: halaman detail submission perlu menunjukkan status **per alamat** ("siapa
 * saja yang sudah dikirimi"), dan satu alamat yang ditolak SMTP relay tidak
 * boleh membatalkan pengiriman ke penerima lain di daftar yang sama.
 *
 * Karena itu kegagalan sebagian tidak melempar error: job dianggap selesai, dan
 * penerima yang gagal ditandai `failed` di log-nya masing-masing. Yang dilempar
 * hanya kegagalan yang menimpa semuanya — misalnya SMTP relay tidak bisa
 * dihubungi sama sekali — supaya BullMQ mengulangnya, dan retry itu hanya akan
 * mengirim ulang ke alamat yang belum berhasil (`beginLog` melewati yang sudah).
 */
export async function processEmailNotification(
  job: Job<EmailNotificationJob>,
): Promise<EmailNotificationResult> {
  const payload = emailNotificationJobSchema.parse(job.data);
  const rule = await loadNotificationRule(payload.notificationRuleId);

  if (!rule) {
    throw new UnrecoverableError(`Aturan notifikasi ${payload.notificationRuleId} sudah tidak ada`);
  }

  if (!rule.isActive) {
    throw new UnrecoverableError(
      `Aturan notifikasi ${payload.notificationRuleId} sedang dinonaktifkan`,
    );
  }

  const context = await resolveContext(payload);
  const isSample = isSampleSubmission(context);
  const entries = describeAnswers(context.schema, context.answers);

  const subject = renderTemplateString(rule.subject ?? DEFAULT_EMAIL_SUBJECT, {
    form: context.formTitle,
    date: context.submittedAt.toLocaleString('id-ID'),
    submissionId: context.submissionId,
    // Jawaban bisa dipakai di subjek lewat nama field, misal `{{nama_lengkap}}`.
    ...Object.fromEntries(entries.map((entry) => [entry.name, entry.display])),
  });

  const showAnswers = (rule.emailTemplateId ?? DEFAULT_EMAIL_TEMPLATE_ID) !== 'submission_alert';
  const detailUrl = isSample
    ? null
    : `${env.DASHBOARD_URL}/forms/${context.formId}/submissions/${context.submissionId}`;

  const element = SubmissionNotification({
    formTitle: context.formTitle,
    submittedAt: context.submittedAt.toLocaleString('id-ID'),
    versionNumber: context.versionNumber,
    entries,
    detailUrl,
    showAnswers,
    isSample,
  });

  // Versi teks dibuat dari komponen yang sama, bukan ditulis terpisah — kalau
  // ditulis terpisah, cepat atau lambat isinya berbeda dari versi HTML-nya.
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);

  const provider = mailProvider();
  const deliveries: EmailDeliveryResult[] = [];
  let transportFailures = 0;

  for (const recipient of payload.recipients) {
    const log =
      payload.mode === 'live' ? await beginLog(context.submissionId, 'email', recipient) : null;

    if (payload.mode === 'live' && !log) {
      logger.info(`${recipient} sudah pernah dikirimi untuk submission ${context.submissionId}`);
      deliveries.push({ recipient, status: 'skipped', messageId: null, error: null });
      continue;
    }

    try {
      const result = await provider.send({ to: recipient, subject, html, text });

      if (result.rejected.length > 0) {
        throw new Error(`Ditolak server email: ${result.rejected.join(', ')}`);
      }

      if (log) await markLogSuccess(log.id);

      deliveries.push({
        recipient,
        status: 'sent',
        messageId: result.messageId,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (log) await markLogFailed(log.id, message);

      transportFailures += 1;
      deliveries.push({ recipient, status: 'failed', messageId: null, error: message });
      logger.error(`Gagal mengirim ke ${recipient}: ${message}`);
    }
  }

  const sent = deliveries.filter((delivery) => delivery.status === 'sent').length;

  logger.info(
    `Submission ${context.submissionId} — ${sent}/${payload.recipients.length} email terkirim lewat ${provider.name}`,
  );

  // Semua penerima gagal: kemungkinan besar bukan soal alamatnya, melainkan
  // relay-nya. Itu jenis kegagalan yang pantas diulang.
  if (transportFailures > 0 && transportFailures === payload.recipients.length) {
    throw new Error(deliveries[0]?.error ?? 'Seluruh pengiriman gagal');
  }

  return { subject, provider: provider.name, deliveries };
}

async function resolveContext(payload: EmailNotificationJob): Promise<SubmissionContext> {
  if (payload.mode === 'test' || !payload.submissionId) {
    const form = await loadFormContext(payload.formId);

    if (!form) throw new UnrecoverableError(`Form ${payload.formId} belum punya versi schema`);

    return buildSampleSubmission(form, new Date());
  }

  const context = await loadSubmissionContext(payload.submissionId);

  if (!context) {
    throw new UnrecoverableError(`Submission ${payload.submissionId} sudah tidak ada`);
  }

  return context;
}
