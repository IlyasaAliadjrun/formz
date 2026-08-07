import { sheetSyncJobSchema, type SheetSyncJob } from '@formz/shared';
import type { Job } from 'bullmq';
import { createLogger } from '../logger';

const logger = createLogger('sheet-sync');

/**
 * Placeholder processor untuk sync submission ke Google Sheets.
 * Implementasi asli (googleapis + update submission_integration_logs)
 * masuk di part integrasi spreadsheet.
 */
export async function processSheetSync(job: Job<SheetSyncJob>): Promise<void> {
  const payload = sheetSyncJobSchema.parse(job.data);

  logger.info(
    `Job #${job.id} diterima — submission=${payload.submissionId} sheet=${payload.sheetName} (belum diimplementasikan)`,
  );

  await Promise.resolve();
}
