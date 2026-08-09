import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  formSchemaSchema,
  validateAnswers,
  type FormSchema,
  type PublicForm,
  type SubmissionPayload,
  type SubmissionResult,
} from '@formz/shared';
import Redis from 'ioredis';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { Prisma } from '../../generated/prisma/client';
import {
  PublishedFormCacheService,
  type CachedPublishedForm,
} from '../forms/published-form-cache.service';
import { SubmissionDispatcherService } from '../queue/submission-dispatcher.service';
import type { OriginPolicy } from './origin-policy';

/**
 * Sisi publik dari modul form: hanya baca schema versi terpublish dan terima
 * jawaban. Tidak ada satu pun query ke tabel `integrations`, `notification_rules`,
 * `users`, atau `submissions` milik orang lain — permukaan yang bisa disentuh
 * website pihak ketiga sengaja dijaga sesempit ini (ARCHITECTURE.md bagian 2).
 */

export interface SubmitContext {
  ipAddress: string | null;
  /** Domain website yang memasang form, dipakai untuk kolom `source_domain`. */
  sourceDomain: string | null;
  userAgent: string | null;
}

/** Berapa lama hasil submit diingat untuk `clientSubmissionId` yang sama. */
const IDEMPOTENCY_TTL_SECONDS = 3_600;

@Injectable()
export class PublicFormsService {
  private readonly logger = new Logger(PublicFormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PublishedFormCacheService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_ENV) private readonly env: Env,
    private readonly dispatcher: SubmissionDispatcherService,
  ) {}

  /**
   * Memuat form dari cache, jatuh ke database kalau belum ada.
   *
   * Dipakai delegasi CORS, guard, dan controller — semuanya dalam satu request
   * yang sama, dan setelah pemanggilan pertama sisanya dilayani Redis.
   */
  async resolve(formKey: string): Promise<CachedPublishedForm | null> {
    const cached = await this.cache.get(formKey);

    if (cached) return cached;

    const form = await this.prisma.form.findUnique({
      where: { formKey },
      select: {
        id: true,
        formKey: true,
        status: true,
        allowedDomains: true,
        versions: {
          where: { publishedAt: { not: null } },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { id: true, versionNumber: true, schema: true },
        },
      },
    });

    // formKey yang tidak dikenal sengaja tidak di-cache: kalau di-cache, siapa
    // pun bisa memenuhi Redis dengan menembak key acak. Rate limit yang menahan
    // penembakan seperti itu, bukan cache.
    if (!form) return null;

    const version = form.versions[0] ?? null;

    const value: CachedPublishedForm = {
      formId: form.id,
      formKey: form.formKey,
      status: form.status,
      allowedDomains: form.allowedDomains,
      formVersionId: version?.id ?? null,
      versionNumber: version?.versionNumber ?? null,
      rateLimitPerHour: readRateLimit(version?.schema),
      schema: version?.schema ?? null,
    };

    await this.cache.set(value);

    return value;
  }

  /** Kebijakan domain untuk sebuah form, atau null kalau formKey tidak dikenal. */
  async originPolicy(formKey: string): Promise<OriginPolicy | null> {
    const form = await this.resolve(formKey);

    if (!form) return null;

    return { allowedDomains: form.allowedDomains, rendererOrigin: this.env.EMBED_URL };
  }

  /**
   * Schema untuk form renderer. Yang dikirim hanya apa yang perlu ditampilkan ke
   * pengisi form; `allowedDomains`, pembuat form, daftar submission, konfigurasi
   * integrasi, dan aturan notifikasi tidak pernah ikut.
   */
  async getPublicForm(formKey: string): Promise<PublicForm> {
    const { form, schema } = await this.loadPublished(formKey);

    return {
      formKey: form.formKey,
      formVersionId: form.formVersionId as string,
      versionNumber: form.versionNumber as number,
      schema: toPublicSchema(schema),
    };
  }

  async submit(
    formKey: string,
    payload: SubmissionPayload,
    context: SubmitContext,
  ): Promise<SubmissionResult> {
    const { form, schema } = await this.loadPublished(formKey);

    // Submit yang sama dikirim dua kali (klik ganda, jaringan putus lalu retry)
    // tidak boleh menghasilkan dua baris — jawaban pertama yang dipakai.
    const existing = await this.findPreviousSubmission(formKey, payload.clientSubmissionId);

    if (existing) {
      return this.successResult(existing, schema);
    }

    // Inilah penutup celah di ARCHITECTURE.md bagian 6 poin 2: `validateAnswers`
    // menjalankan `getEffectiveAnswers`, jadi jawaban untuk field yang menurut
    // kondisi seharusnya tersembunyi dibuang di sini — tidak peduli bahwa
    // pengirimnya menyertakannya secara manual di request.
    const result = validateAnswers(schema, payload.answers);

    if (!result.valid) {
      throw new BadRequestException({
        message: 'Ada isian yang belum sesuai',
        errors: result.errors,
      });
    }

    const submission = await this.prisma.submission.create({
      data: {
        formId: form.formId,
        // Snapshot versi schema: tampilan histori tidak ikut berubah kalau
        // form-nya diedit setelah ini (ARCHITECTURE.md bagian 6 poin 1).
        formVersionId: form.formVersionId as string,
        answers: result.answers as unknown as Prisma.InputJsonValue,
        ipAddress: context.ipAddress,
        sourceDomain: context.sourceDomain,
      },
      select: { id: true },
    });

    await this.rememberSubmission(formKey, payload.clientSubmissionId, submission.id);

    this.logger.log(
      `Submission ${submission.id} masuk untuk form ${formKey} (versi ${form.versionNumber})`,
    );

    // Sync spreadsheet dan kirim email dikerjakan di antrean, bukan di sini.
    // Kalau dikerjakan sinkron, orang yang mengisi form di website lain ikut
    // menunggu Google API dan SMTP relay (ARCHITECTURE.md bagian 2).
    await this.dispatcher.dispatchQuietly({
      formId: form.formId,
      submissionId: submission.id,
      schema,
      answers: result.answers,
    });

    return this.successResult(submission.id, schema);
  }

  // -------------------------------------------------------------------------
  // Helper
  // -------------------------------------------------------------------------

  /**
   * Form yang tidak ada, masih draft, dan sudah diarsipkan sama-sama menghasilkan
   * 404 dengan pesan identik — supaya orang tidak bisa memetakan formKey mana
   * yang benar-benar ada hanya dari beda pesan error.
   */
  private async loadPublished(
    formKey: string,
  ): Promise<{ form: CachedPublishedForm; schema: FormSchema }> {
    const form = await this.resolve(formKey);

    if (!form || form.status !== 'published' || !form.formVersionId) {
      throw new NotFoundException('Form tidak ditemukan atau belum dipublish');
    }

    const parsed = formSchemaSchema.safeParse(form.schema);

    if (!parsed.success) {
      // Schema tersimpan yang tidak lolos parse artinya ada bug di sisi kami,
      // bukan kesalahan pengisi form.
      this.logger.error(
        `Schema versi terpublish form ${formKey} tidak bisa dibaca: ${parsed.error.message}`,
      );
      throw new InternalServerErrorException('Schema form tidak bisa dibaca');
    }

    return { form, schema: parsed.data };
  }

  private successResult(submissionId: string, schema: FormSchema): SubmissionResult {
    return {
      submissionId,
      status: 'received',
      message: schema.settings.successMessage,
      ...(schema.settings.redirectUrl ? { redirectUrl: schema.settings.redirectUrl } : {}),
    };
  }

  private async findPreviousSubmission(
    formKey: string,
    clientSubmissionId: string | undefined,
  ): Promise<string | null> {
    if (!clientSubmissionId) return null;

    try {
      return await this.redis.get(idempotencyKey(formKey, clientSubmissionId));
    } catch (error) {
      this.logger.warn(`Gagal membaca kunci idempotency: ${describe(error)}`);

      return null;
    }
  }

  private async rememberSubmission(
    formKey: string,
    clientSubmissionId: string | undefined,
    submissionId: string,
  ): Promise<void> {
    if (!clientSubmissionId) return;

    try {
      await this.redis.set(
        idempotencyKey(formKey, clientSubmissionId),
        submissionId,
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`Gagal menyimpan kunci idempotency: ${describe(error)}`);
    }
  }
}

/**
 * Membuang pengaturan yang tidak ada urusannya dengan menampilkan form.
 * `rateLimitPerHour` hanya dipakai server dan tidak perlu diketahui pengisi form.
 *
 * Tipenya tetap `FormSchema` walau satu kunci sengaja dihilangkan: renderer
 * mem-parse ulang payload dengan `formSchemaSchema`, dan Zod mengisi kembali
 * nilai default untuk kunci yang hilang itu — nilai yang memang tidak pernah
 * dibaca di sisi klien.
 */
function toPublicSchema(schema: FormSchema): FormSchema {
  const { rateLimitPerHour: _serverOnly, ...visibleSettings } = schema.settings;

  return { ...schema, settings: visibleSettings as FormSchema['settings'] };
}

/** Membaca `settings.rateLimitPerHour` dari JSONB tanpa mem-parse seluruh schema. */
function readRateLimit(schema: unknown): number | null {
  if (typeof schema !== 'object' || schema === null) return null;

  const settings = (schema as { settings?: unknown }).settings;

  if (typeof settings !== 'object' || settings === null) return null;

  const value = (settings as { rateLimitPerHour?: unknown }).rateLimitPerHour;

  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function idempotencyKey(formKey: string, clientSubmissionId: string): string {
  return `submit:idem:${formKey}:${clientSubmissionId}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
