import { emailNotificationJobSchema, type EmailNotificationJob } from '@formz/shared';
import type { Job } from 'bullmq';
import { createLogger } from '../logger';

const logger = createLogger('email-notification');

/**
 * Placeholder processor untuk workflow notifikasi email.
 * Implementasi asli (SMTP relay + React Email + log status) masuk di part notifikasi.
 */
export async function processEmailNotification(job: Job<EmailNotificationJob>): Promise<void> {
  const payload = emailNotificationJobSchema.parse(job.data);

  logger.info(
    `Job #${job.id} diterima — submission=${payload.submissionId} to=${payload.to.join(', ')} (belum diimplementasikan)`,
  );

  await Promise.resolve();
}
