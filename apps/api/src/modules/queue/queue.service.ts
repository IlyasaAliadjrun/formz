import {
  Inject,
  Injectable,
  Logger,
  RequestTimeoutException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DEFAULT_JOB_OPTIONS,
  JOB_NAMES,
  QUEUE_NAMES,
  REPORT_REFRESH_JOB_OPTIONS,
  REPORT_REFRESH_MANUAL_JOB_ID,
  TEST_JOB_OPTIONS,
  emailNotificationJobId,
  sheetSyncJobId,
  type EmailNotificationJob,
  type EmailNotificationResult,
  type QueueName,
  type SheetSyncJob,
  type SheetSyncResult,
} from '@formz/shared';
import { Queue, QueueEvents, type Job } from 'bullmq';
import {
  EMAIL_NOTIFICATION_QUEUE,
  EMAIL_NOTIFICATION_QUEUE_EVENTS,
  REPORT_REFRESH_QUEUE,
  SHEET_SYNC_QUEUE,
  SHEET_SYNC_QUEUE_EVENTS,
} from './queue.constants';

/** Ringkasan isi satu queue untuk halaman pemantauan. */
export interface QueueCounts {
  name: QueueName;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Batas tunggu tombol "Test Kirim". Cukup panjang untuk Google API yang lambat,
 * cukup pendek supaya request-nya tidak menggantung kalau worker sedang mati.
 */
const TEST_TIMEOUT_MS = 30_000;

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @Inject(SHEET_SYNC_QUEUE) private readonly sheetQueue: Queue,
    @Inject(EMAIL_NOTIFICATION_QUEUE) private readonly emailQueue: Queue,
    @Inject(REPORT_REFRESH_QUEUE) private readonly reportQueue: Queue,
    @Inject(SHEET_SYNC_QUEUE_EVENTS) private readonly sheetEvents: QueueEvents,
    @Inject(EMAIL_NOTIFICATION_QUEUE_EVENTS) private readonly emailEvents: QueueEvents,
  ) {}

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  async enqueueSheetSync(data: SheetSyncJob): Promise<void> {
    const jobId = sheetSyncJobId(data.submissionId ?? 'unknown', data.integrationId);

    await this.sheetQueue.add(JOB_NAMES.SYNC_TO_SHEET, data, { ...DEFAULT_JOB_OPTIONS, jobId });
  }

  async enqueueEmailNotification(data: EmailNotificationJob): Promise<void> {
    const jobId = emailNotificationJobId(data.submissionId ?? 'unknown', data.notificationRuleId);

    await this.emailQueue.add(JOB_NAMES.SEND_NOTIFICATION, data, {
      ...DEFAULT_JOB_OPTIONS,
      jobId,
    });
  }

  /**
   * Meminta refresh materialized view laporan di luar jadwal.
   *
   * `jobId` tetap berfungsi sebagai peredam: selama job dengan id ini masih
   * menunggu atau berjalan, permintaan berikutnya diabaikan BullMQ. Jadi
   * menekan tombol "Perbarui data" sepuluh kali beruntun tetap menghasilkan
   * satu kali agregasi ulang, tanpa penghitung waktu tambahan di mana pun.
   *
   * Mengembalikan false kalau permintaannya digabung ke job yang sudah antre.
   */
  async requestReportRefresh(): Promise<boolean> {
    const existing = await this.reportQueue.getJob(REPORT_REFRESH_MANUAL_JOB_ID);

    if (existing) {
      const state = await existing.getState();

      // Masih akan dikerjakan — permintaan ini cukup menumpang ke sana.
      if (state === 'waiting' || state === 'active' || state === 'delayed') return false;

      // Sisa job yang sudah selesai tetap tersimpan (removeOnComplete menahan
      // riwayatnya untuk Bull Board), dan selama ia ada, `add` dengan id yang
      // sama tidak melakukan apa-apa. Jadi bangkainya dibersihkan dulu.
      await existing.remove().catch(() => undefined);
    }

    await this.reportQueue.add(
      JOB_NAMES.REFRESH_REPORTS,
      { reason: 'manual' },
      { ...REPORT_REFRESH_JOB_OPTIONS, jobId: REPORT_REFRESH_MANUAL_JOB_ID },
    );

    return true;
  }

  /**
   * Menghapus job lama dengan id yang sama sebelum mengantre ulang.
   *
   * `jobId` adalah kunci deduplikasi BullMQ: selama job gagal masih tersimpan
   * (removeOnFail menahannya seminggu), `add` dengan id yang sama tidak
   * melakukan apa-apa. Tombol retry manual justru butuh job itu dijalankan
   * lagi, jadi sisanya dibersihkan lebih dulu.
   */
  async forget(queue: QueueName, jobId: string): Promise<void> {
    try {
      await this.queueOf(queue).remove(jobId);
    } catch (error) {
      // Job yang sedang berjalan tidak bisa dihapus — itu bukan masalah di sini,
      // karena artinya pekerjaannya memang sedang dikerjakan.
      this.logger.debug(`Job ${jobId} tidak bisa dihapus: ${describe(error)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Uji coba
  // -------------------------------------------------------------------------

  /**
   * Menjalankan job uji coba lalu menunggu hasilnya.
   *
   * Sengaja lewat antrean, bukan dipanggil langsung dari API: yang perlu diuji
   * justru jalur yang dipakai sungguhan — kredensial di worker, konfigurasi yang
   * tersimpan, dan hasil render template. Uji coba yang menempuh jalur berbeda
   * dari produksi tidak membuktikan apa pun.
   */
  runSheetSyncTest(data: SheetSyncJob): Promise<SheetSyncResult> {
    return this.runTest(this.sheetQueue, this.sheetEvents, JOB_NAMES.SYNC_TO_SHEET, data);
  }

  runEmailNotificationTest(data: EmailNotificationJob): Promise<EmailNotificationResult> {
    return this.runTest(this.emailQueue, this.emailEvents, JOB_NAMES.SEND_NOTIFICATION, data);
  }

  private async runTest<TData, TResult>(
    queue: Queue,
    events: QueueEvents,
    jobName: string,
    data: TData,
  ): Promise<TResult> {
    const job = (await queue.add(jobName, data, TEST_JOB_OPTIONS)) as Job<TData, TResult>;

    try {
      return await job.waitUntilFinished(events, TEST_TIMEOUT_MS);
    } catch (error) {
      if (isTimeout(error)) {
        throw new RequestTimeoutException(
          'Uji coba tidak selesai dalam 30 detik. Pastikan service worker sedang berjalan.',
        );
      }

      // `waitUntilFinished` melempar Error biasa berisi alasan kegagalan job.
      // Tanpa dibungkus HttpException, Nest mengubahnya menjadi 500 "Internal
      // server error" — dan pesan dari Google/SMTP yang justru paling berguna
      // bagi admin hilang di jalan.
      throw new UnprocessableEntityException(describe(error));
    } finally {
      await job.remove().catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // Pemantauan
  // -------------------------------------------------------------------------

  async counts(): Promise<QueueCounts[]> {
    return Promise.all([
      this.countsOf(QUEUE_NAMES.SHEET_SYNC),
      this.countsOf(QUEUE_NAMES.EMAIL_NOTIFICATION),
      this.countsOf(QUEUE_NAMES.REPORT_REFRESH),
    ]);
  }

  private async countsOf(name: QueueName): Promise<QueueCounts> {
    const counts = await this.queueOf(name).getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );

    return {
      name,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    };
  }

  private queueOf(name: QueueName): Queue {
    if (name === QUEUE_NAMES.SHEET_SYNC) return this.sheetQueue;
    if (name === QUEUE_NAMES.REPORT_REFRESH) return this.reportQueue;

    return this.emailQueue;
  }
}

/** BullMQ menandai timeout `waitUntilFinished` lewat pesan errornya. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && /timed out/i.test(error.message);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
