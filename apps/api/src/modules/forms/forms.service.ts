import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  createEmptyFormSchema,
  formSchemaSchema,
  validateForPublish,
  type FormSchema,
  type FormStatus,
  type SchemaValidationResult,
} from '@formz/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type {
  CreateFormDto,
  EmbedSettingsDto,
  ListFormsDto,
  PublishFormDto,
  UpdateFormDto,
} from './dto/forms.dto';

/** Panjang formKey dalam byte sebelum di-encode base64url (16 byte → 22 karakter). */
const FORM_KEY_BYTES = 16;

const FORM_SELECT = {
  id: true,
  formKey: true,
  title: true,
  description: true,
  status: true,
  allowedDomains: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
  _count: { select: { submissions: true } },
} as const;

export interface FormSummary {
  id: string;
  formKey: string;
  title: string;
  description: string | null;
  status: FormStatus;
  allowedDomains: string[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; name: string; email: string } | null;
  submissionCount: number;
  /** Versi terpublish terakhir, null kalau form belum pernah dipublish. */
  publishedVersion: { id: string; versionNumber: number; publishedAt: Date } | null;
  /** True kalau ada perubahan draft yang belum dipublish. */
  hasUnpublishedChanges: boolean;
}

export interface FormDetail extends FormSummary {
  /** Schema yang sedang diedit. Inilah yang dibaca & ditulis form builder. */
  draftSchema: FormSchema;
  /** Hasil pemeriksaan draft — dipakai UI untuk menandai masalah sebelum publish. */
  validation: SchemaValidationResult;
}

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListFormsDto): Promise<{
    data: FormSummary[];
    meta: { page: number; perPage: number; total: number; totalPages: number };
  }> {
    const where: Prisma.FormWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.form.findMany({
        where,
        select: { ...FORM_SELECT, versions: { select: VERSION_SUMMARY_SELECT } },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.form.count({ where }),
    ]);

    return {
      data: rows.map(toFormSummary),
      meta: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      },
    };
  }

  async findById(id: string): Promise<FormDetail> {
    const form = await this.prisma.form.findUnique({
      where: { id },
      select: { ...FORM_SELECT, versions: { select: VERSION_SUMMARY_SELECT } },
    });

    if (!form) throw new NotFoundException(`Form ${id} tidak ditemukan`);

    const draftSchema = await this.readDraftSchema(id, form.title, form.description);

    return {
      ...toFormSummary(form),
      draftSchema,
      validation: validateForPublish(draftSchema),
    };
  }

  async create(dto: CreateFormDto, createdById: string): Promise<FormDetail> {
    const schema = createEmptyFormSchema(dto.title, dto.description);

    const form = await this.prisma.form.create({
      data: {
        formKey: generateFormKey(),
        title: dto.title,
        description: dto.description ?? null,
        // Form baru selalu mulai sebagai draft.
        status: 'draft',
        allowedDomains: [],
        createdById,
        // Draft = baris form_versions dengan published_at masih null.
        versions: {
          create: { versionNumber: 1, schema: schema as unknown as Prisma.InputJsonValue },
        },
      },
      select: { ...FORM_SELECT, versions: { select: VERSION_SUMMARY_SELECT } },
    });

    this.logger.log(`Form dibuat: ${form.title} (${form.formKey})`);

    return {
      ...toFormSummary(form),
      draftSchema: schema,
      validation: validateForPublish(schema),
    };
  }

  /**
   * Memperbarui draft. Tidak pernah membuat versi baru — versi baru hanya lahir
   * saat publish. Kalau versi terakhir sudah terpublish, baris draft baru dibuat
   * di sini supaya versi yang sudah dipublish tidak tertimpa.
   */
  async update(id: string, dto: UpdateFormDto): Promise<FormDetail> {
    const form = await this.prisma.form.findUnique({
      where: { id },
      select: { id: true, title: true, description: true, status: true },
    });

    if (!form) throw new NotFoundException(`Form ${id} tidak ditemukan`);

    if (dto.schema) {
      await this.writeDraftSchema(id, dto.schema);
    }

    if (dto.title !== undefined || dto.description !== undefined) {
      await this.prisma.form.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
      });

      // Judul form ada di dua tempat: kolom `forms.title` (untuk daftar & pencarian)
      // dan di dalam schema (yang dirender ke pengisi form). Keduanya disamakan.
      if (dto.title !== undefined && !dto.schema) {
        const current = await this.readDraftSchema(id, dto.title, dto.description ?? null);
        await this.writeDraftSchema(id, { ...current, title: dto.title });
      }
    } else if (dto.schema) {
      // Sentuh updatedAt supaya urutan "terakhir diubah" di daftar form tetap benar.
      await this.prisma.form.update({ where: { id }, data: { updatedAt: new Date() } });
    }

    return this.findById(id);
  }

  /**
   * Publish: memvalidasi draft lalu menandai baris draft sebagai versi terpublish.
   * Versi lama tidak pernah ditimpa — submission yang sudah masuk tetap menunjuk
   * ke versi schema saat itu (ARCHITECTURE.md bagian 6 poin 1).
   */
  async publish(id: string, dto: PublishFormDto): Promise<FormDetail> {
    const form = await this.prisma.form.findUnique({
      where: { id },
      select: { id: true, title: true, description: true, status: true },
    });

    if (!form) throw new NotFoundException(`Form ${id} tidak ditemukan`);

    const draft = await this.prisma.formVersion.findFirst({
      where: { formId: id, publishedAt: null },
      orderBy: { versionNumber: 'desc' },
    });

    if (!draft) {
      throw new ConflictException(
        'Tidak ada perubahan draft yang bisa dipublish — versi terakhir sudah terpublish',
      );
    }

    const schema = parseSchema(draft.schema, form.title, form.description);
    const validation = validateForPublish(schema);

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Schema form belum valid, publish dibatalkan',
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    if (!dto.ignoreWarnings && validation.warnings.length > 0) {
      throw new BadRequestException({
        message: 'Schema form punya peringatan yang belum diselesaikan',
        errors: [],
        warnings: validation.warnings,
      });
    }

    await this.prisma.$transaction([
      this.prisma.formVersion.update({
        where: { id: draft.id },
        data: { publishedAt: new Date() },
      }),
      this.prisma.form.update({
        where: { id },
        // Publish sekaligus mengembalikan form yang diarsipkan ke keadaan aktif.
        data: { status: 'published' },
      }),
    ]);

    this.logger.log(`Form ${form.title} dipublish sebagai versi ${draft.versionNumber}`);

    return this.findById(id);
  }

  /**
   * Form yang sudah punya submission diarsipkan, bukan dihapus — histori jawaban
   * harus tetap bisa dibaca. Form yang belum pernah diisi boleh dihapus permanen.
   */
  async remove(
    id: string,
  ): Promise<{ deleted: boolean; status: FormStatus | null; message: string }> {
    const form = await this.prisma.form.findUnique({
      where: { id },
      select: { id: true, title: true, status: true, _count: { select: { submissions: true } } },
    });

    if (!form) throw new NotFoundException(`Form ${id} tidak ditemukan`);

    if (form._count.submissions > 0) {
      await this.prisma.form.update({ where: { id }, data: { status: 'archived' } });

      this.logger.log(`Form ${form.title} diarsipkan (${form._count.submissions} submission)`);

      return {
        deleted: false,
        status: 'archived',
        message: `Form diarsipkan karena sudah punya ${form._count.submissions} submission`,
      };
    }

    // form_versions ikut terhapus lewat cascade; tidak ada submission yang menahan.
    await this.prisma.form.delete({ where: { id } });

    this.logger.log(`Form ${form.title} dihapus permanen (belum ada submission)`);

    // status null: form-nya sudah tidak ada lagi, jadi tidak punya status apa pun.
    return { deleted: true, status: null, message: 'Form dihapus permanen' };
  }

  async updateEmbedSettings(id: string, dto: EmbedSettingsDto): Promise<FormSummary> {
    const exists = await this.prisma.form.findUnique({ where: { id }, select: { id: true } });

    if (!exists) throw new NotFoundException(`Form ${id} tidak ditemukan`);

    // Duplikat dibuang supaya daftar whitelist tetap bersih.
    const allowedDomains = [...new Set(dto.allowedDomains)];

    const form = await this.prisma.form.update({
      where: { id },
      data: { allowedDomains },
      select: { ...FORM_SELECT, versions: { select: VERSION_SUMMARY_SELECT } },
    });

    this.logger.log(
      `Whitelist embed form ${form.title} diubah: ${allowedDomains.length === 0 ? '(semua domain)' : allowedDomains.join(', ')}`,
    );

    return toFormSummary(form);
  }

  // -------------------------------------------------------------------------
  // Draft helper
  // -------------------------------------------------------------------------

  private async readDraftSchema(
    formId: string,
    fallbackTitle: string,
    fallbackDescription: string | null,
  ): Promise<FormSchema> {
    const draft = await this.prisma.formVersion.findFirst({
      where: { formId, publishedAt: null },
      orderBy: { versionNumber: 'desc' },
    });

    if (draft) return parseSchema(draft.schema, fallbackTitle, fallbackDescription);

    // Tidak ada draft berarti versi terakhir sudah dipublish — draft berikutnya
    // dimulai dari salinan versi terpublish itu.
    const latestPublished = await this.prisma.formVersion.findFirst({
      where: { formId, publishedAt: { not: null } },
      orderBy: { versionNumber: 'desc' },
    });

    if (latestPublished) {
      return parseSchema(latestPublished.schema, fallbackTitle, fallbackDescription);
    }

    return createEmptyFormSchema(fallbackTitle, fallbackDescription ?? undefined);
  }

  private async writeDraftSchema(formId: string, schema: FormSchema): Promise<void> {
    const draft = await this.prisma.formVersion.findFirst({
      where: { formId, publishedAt: null },
      orderBy: { versionNumber: 'desc' },
      select: { id: true },
    });

    const payload = schema as unknown as Prisma.InputJsonValue;

    if (draft) {
      await this.prisma.formVersion.update({ where: { id: draft.id }, data: { schema: payload } });
      return;
    }

    const latest = await this.prisma.formVersion.findFirst({
      where: { formId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    await this.prisma.formVersion.create({
      data: {
        formId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        schema: payload,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Pemetaan hasil query
// ---------------------------------------------------------------------------

const VERSION_SUMMARY_SELECT = {
  id: true,
  versionNumber: true,
  publishedAt: true,
} as const;

interface FormRow {
  id: string;
  formKey: string;
  title: string;
  description: string | null;
  status: FormStatus;
  allowedDomains: string[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; name: string; email: string } | null;
  _count: { submissions: number };
  versions: Array<{ id: string; versionNumber: number; publishedAt: Date | null }>;
}

function toFormSummary(form: FormRow): FormSummary {
  const published = form.versions
    .filter((version) => version.publishedAt !== null)
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];

  const hasDraft = form.versions.some((version) => version.publishedAt === null);

  return {
    id: form.id,
    formKey: form.formKey,
    title: form.title,
    description: form.description,
    status: form.status,
    allowedDomains: form.allowedDomains,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    createdBy: form.createdBy,
    submissionCount: form._count.submissions,
    publishedVersion: published
      ? {
          id: published.id,
          versionNumber: published.versionNumber,
          publishedAt: published.publishedAt as Date,
        }
      : null,
    hasUnpublishedChanges: hasDraft,
  };
}

/**
 * Membaca schema dari JSONB. Kalau isinya tidak lolos parse (misal ditulis oleh
 * versi aplikasi lama), dikembalikan schema kosong alih-alih melempar error —
 * supaya satu form rusak tidak membuat seluruh daftar form gagal dimuat.
 */
function parseSchema(
  value: unknown,
  fallbackTitle: string,
  fallbackDescription: string | null,
): FormSchema {
  const parsed = formSchemaSchema.safeParse(value);

  if (parsed.success) return parsed.data;

  return createEmptyFormSchema(fallbackTitle, fallbackDescription ?? undefined);
}

function generateFormKey(): string {
  return randomBytes(FORM_KEY_BYTES).toString('base64url');
}
