import { z } from 'zod';

/** Nilai jawaban yang mungkin disimpan untuk satu field. */
export const answerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type AnswerValue = z.infer<typeof answerValueSchema>;

/** Payload yang dikirim form renderer ke POST /public/forms/:formKey/submit. */
export const submissionPayloadSchema = z.object({
  /** Key: field.id, Value: jawaban. */
  answers: z.record(z.string(), answerValueSchema),
  /** Dipakai untuk idempotency job sync (lihat ARCHITECTURE.md bagian 6 poin 3). */
  clientSubmissionId: z.uuid().optional(),
  metadata: z
    .object({
      referrer: z.string().optional(),
      userAgent: z.string().optional(),
      locale: z.string().optional(),
    })
    .optional(),
});
export type SubmissionPayload = z.infer<typeof submissionPayloadSchema>;

export const submissionStatusSchema = z.enum(['received', 'processing', 'completed', 'failed']);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

/** Jenis integrasi yang dicatat di tabel submission_integration_logs. */
export const integrationTypeSchema = z.enum(['sheet', 'email']);
export type IntegrationType = z.infer<typeof integrationTypeSchema>;

export const integrationStatusSchema = z.enum(['pending', 'success', 'failed', 'skipped']);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const integrationLogSchema = z.object({
  id: z.string(),
  submissionId: z.string(),
  type: integrationTypeSchema,
  status: integrationStatusSchema,
  /** Email tujuan atau nama sheet target. */
  target: z.string().nullable(),
  retryCount: z.number().int().nonnegative().default(0),
  errorMessage: z.string().nullable().optional(),
  syncedAt: z.iso.datetime().nullable().optional(),
});
export type IntegrationLog = z.infer<typeof integrationLogSchema>;

/** Respons endpoint submit publik. */
export const submissionResultSchema = z.object({
  submissionId: z.string(),
  status: submissionStatusSchema,
  message: z.string(),
  redirectUrl: z.url().optional(),
});
export type SubmissionResult = z.infer<typeof submissionResultSchema>;
