import { BadRequestException, NotFoundException } from '@nestjs/common';
import { formSchemaSchema } from '@formz/shared';
import type Redis from 'ioredis';
import type { Env } from '../../config/env.schema';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CachedPublishedForm,
  PublishedFormCacheService,
} from '../forms/published-form-cache.service';
import type { SubmissionDispatcherService } from '../queue/submission-dispatcher.service';
import { PublicFormsService } from './public-forms.service';

/**
 * Schema uji: satu select yang menentukan tampil-tidaknya field wajib di bawahnya.
 * Bentuk yang sama dipakai di test evaluator conditions supaya perilakunya bisa
 * dibandingkan langsung.
 */
const SCHEMA = formSchemaSchema.parse({
  version: 1,
  title: 'Form Pendaftaran',
  fields: [
    {
      id: 'field_001',
      name: 'jenis_layanan',
      type: 'select',
      label: 'Jenis Layanan',
      options: [
        { id: 'opt_1', label: 'Konsultasi' },
        { id: 'opt_2', label: 'Implementasi' },
      ],
      validation: { required: true },
    },
    {
      id: 'field_002',
      name: 'durasi',
      type: 'number',
      label: 'Durasi',
      validation: { required: true },
      conditions: {
        visibility: {
          action: 'show',
          logic: 'AND',
          rules: [{ fieldId: 'field_001', operator: 'equals', value: 'opt_2' }],
        },
      },
    },
  ],
  settings: { successMessage: 'Terima kasih!', rateLimitPerHour: 30 },
});

const PUBLISHED: CachedPublishedForm = {
  formId: 'form-id',
  formKey: 'AbCdEfGhIjKlMnOpQrStUv',
  status: 'published',
  allowedDomains: [],
  formVersionId: 'version-id',
  versionNumber: 2,
  rateLimitPerHour: 30,
  schema: SCHEMA,
};

const CONTEXT = { ipAddress: '10.0.0.1', sourceDomain: 'klien.com', userAgent: 'jest' };

describe('PublicFormsService', () => {
  let service: PublicFormsService;
  let prisma: { form: { findUnique: jest.Mock }; submission: { create: jest.Mock } };
  let cache: { get: jest.Mock; set: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };
  let dispatcher: { dispatchQuietly: jest.Mock };

  beforeEach(() => {
    prisma = {
      form: { findUnique: jest.fn() },
      submission: { create: jest.fn().mockResolvedValue({ id: 'submission-id' }) },
    };
    cache = { get: jest.fn().mockResolvedValue(PUBLISHED), set: jest.fn() };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    dispatcher = { dispatchQuietly: jest.fn().mockResolvedValue(undefined) };

    service = new PublicFormsService(
      prisma as unknown as PrismaService,
      cache as unknown as PublishedFormCacheService,
      redis as unknown as Redis,
      { EMBED_URL: 'http://localhost:5173' } as Env,
      dispatcher as unknown as SubmissionDispatcherService,
    );
  });

  describe('getPublicForm', () => {
    it('mengembalikan schema versi terpublish', async () => {
      const result = await service.getPublicForm(PUBLISHED.formKey);

      expect(result.formKey).toBe(PUBLISHED.formKey);
      expect(result.versionNumber).toBe(2);
      expect(result.schema.fields).toHaveLength(2);
    });

    it('tidak menyertakan pengaturan yang hanya dipakai server', () => {
      return service.getPublicForm(PUBLISHED.formKey).then((result) => {
        expect(result.schema.settings).not.toHaveProperty('rateLimitPerHour');
        expect(result.schema.settings.successMessage).toBe('Terima kasih!');
      });
    });

    it('menolak form yang belum dipublish dengan 404', async () => {
      cache.get.mockResolvedValue({ ...PUBLISHED, status: 'draft' });

      await expect(service.getPublicForm(PUBLISHED.formKey)).rejects.toThrow(NotFoundException);
    });

    it('menolak form yang diarsipkan dengan pesan yang sama seperti form tidak ada', async () => {
      cache.get.mockResolvedValue({ ...PUBLISHED, status: 'archived' });

      await expect(service.getPublicForm(PUBLISHED.formKey)).rejects.toThrow(
        'Form tidak ditemukan atau belum dipublish',
      );
    });
  });

  describe('submit', () => {
    it('menyimpan jawaban yang valid beserta snapshot versi schema', async () => {
      const result = await service.submit(
        PUBLISHED.formKey,
        { answers: { field_001: 'opt_1' } },
        CONTEXT,
      );

      expect(result).toMatchObject({
        submissionId: 'submission-id',
        status: 'received',
        message: 'Terima kasih!',
      });

      expect(prisma.submission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            formId: 'form-id',
            formVersionId: 'version-id',
            answers: { field_001: 'opt_1' },
            ipAddress: '10.0.0.1',
            sourceDomain: 'klien.com',
          }),
        }),
      );
    });

    it('membuang jawaban untuk field yang seharusnya tersembunyi', async () => {
      // field_002 hanya tampil kalau opt_2 dipilih. Di sini opt_1 yang dipilih,
      // tapi jawaban field_002 tetap disertakan — persis manipulasi request yang
      // disebut ARCHITECTURE.md bagian 6 poin 2.
      await service.submit(
        PUBLISHED.formKey,
        { answers: { field_001: 'opt_1', field_002: 99 } },
        CONTEXT,
      );

      const data = prisma.submission.create.mock.calls[0][0].data as { answers: unknown };

      expect(data.answers).toEqual({ field_001: 'opt_1' });
    });

    it('menolak jawaban yang tidak lolos validasi', async () => {
      // opt_2 membuat field_002 tampil dan wajib diisi.
      await expect(
        service.submit(PUBLISHED.formKey, { answers: { field_001: 'opt_2' } }, CONTEXT),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.submission.create).not.toHaveBeenCalled();
    });

    it('menolak submit ke form yang belum dipublish', async () => {
      cache.get.mockResolvedValue({ ...PUBLISHED, status: 'draft' });

      await expect(
        service.submit(PUBLISHED.formKey, { answers: { field_001: 'opt_1' } }, CONTEXT),
      ).rejects.toThrow(NotFoundException);
    });

    it('mengembalikan submission yang sama untuk clientSubmissionId yang diulang', async () => {
      redis.get.mockResolvedValue('submission-sebelumnya');

      const result = await service.submit(
        PUBLISHED.formKey,
        {
          answers: { field_001: 'opt_1' },
          clientSubmissionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        },
        CONTEXT,
      );

      expect(result.submissionId).toBe('submission-sebelumnya');
      expect(prisma.submission.create).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('membaca database dan mengisi cache saat cache masih kosong', async () => {
      cache.get.mockResolvedValue(null);
      prisma.form.findUnique.mockResolvedValue({
        id: 'form-id',
        formKey: PUBLISHED.formKey,
        status: 'published',
        allowedDomains: ['klien.com'],
        versions: [{ id: 'version-id', versionNumber: 2, schema: SCHEMA }],
      });

      const result = await service.resolve(PUBLISHED.formKey);

      expect(result).toMatchObject({
        formVersionId: 'version-id',
        allowedDomains: ['klien.com'],
        // Diangkat keluar dari schema supaya guard rate limit tidak perlu mem-parse.
        rateLimitPerHour: 30,
      });
      expect(cache.set).toHaveBeenCalledTimes(1);
    });

    it('tidak menyimpan formKey yang tidak dikenal ke cache', async () => {
      cache.get.mockResolvedValue(null);
      prisma.form.findUnique.mockResolvedValue(null);

      expect(await service.resolve('TidakAdaFormKeyIni')).toBeNull();
      expect(cache.set).not.toHaveBeenCalled();
    });
  });
});
