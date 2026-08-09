import { QUEUE_NAMES } from '@formz/shared';
import { Worker, type Processor } from 'bullmq';
import { closeConnections, redis, verifyConnections } from './connections';
import { env } from './env';
import { hasGoogleCredentials } from './google/sheets';
import { createLogger } from './logger';
import { mailProvider } from './mail';
import { processEmailNotification } from './processors/email-notification.processor';
import { processSheetSync } from './processors/sheet-sync.processor';

const logger = createLogger('worker');

function createWorker(queueName: string, processor: Processor): Worker {
  const worker = new Worker(queueName, processor, {
    connection: redis,
    concurrency: env.WORKER_CONCURRENCY,
  });

  worker.on('completed', (job) => logger.info(`[${queueName}] job #${job.id} selesai`));
  worker.on('failed', (job, error) =>
    logger.error(`[${queueName}] job #${job?.id ?? '-'} gagal: ${error.message}`),
  );
  worker.on('error', (error) => logger.error(`[${queueName}] worker error: ${error.message}`));

  return worker;
}

async function bootstrap(): Promise<void> {
  await verifyConnections();
  await reportIntegrationReadiness();

  const workers = [
    createWorker(QUEUE_NAMES.SHEET_SYNC, processSheetSync as Processor),
    createWorker(QUEUE_NAMES.EMAIL_NOTIFICATION, processEmailNotification as Processor),
  ];

  logger.info(
    `Worker siap — queue: ${Object.values(QUEUE_NAMES).join(', ')} (concurrency ${env.WORKER_CONCURRENCY})`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Menerima ${signal}, menutup worker...`);
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await closeConnections();
    logger.info('Worker berhenti dengan bersih');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

/**
 * Melaporkan keadaan kredensial integrasi saat start.
 *
 * Tidak menggagalkan boot: instalasi yang hanya memakai notifikasi email tidak
 * perlu kredensial Google, dan sebaliknya. Yang perlu dihindari adalah keadaan
 * "job terus gagal tanpa ada yang tahu kenapa" — jadi kekurangannya disebutkan
 * satu kali di awal, bukan hanya muncul sebagai error job ke sekian.
 */
async function reportIntegrationReadiness(): Promise<void> {
  if (hasGoogleCredentials()) {
    logger.info(`Google Sheets siap — service account ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
  } else {
    logger.warn(
      'Kredensial Google belum diisi — job sync-to-sheet akan gagal ' +
        '(GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_PRIVATE_KEY)',
    );
  }

  try {
    const provider = mailProvider();
    await provider.verify();
    logger.info(`Pengiriman email siap lewat ${provider.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Pengiriman email belum siap: ${message}`);
  }
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Gagal start worker: ${message}`);
  process.exit(1);
});
