import { QUEUE_NAMES } from '@formz/shared';
import { Worker, type Processor } from 'bullmq';
import { closeConnections, redis, verifyConnections } from './connections';
import { env } from './env';
import { createLogger } from './logger';
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

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Gagal start worker: ${message}`);
  process.exit(1);
});
