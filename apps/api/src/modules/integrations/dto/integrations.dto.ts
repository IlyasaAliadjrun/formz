import {
  DEFAULT_EMAIL_SUBJECT,
  DEFAULT_EMAIL_TEMPLATE_ID,
  conditionGroupSchema,
  emailTemplateIdSchema,
  extractSpreadsheetId,
  googleSheetConfigSchema,
  notificationTriggerSchema,
  recipientRulesSchema,
} from '@formz/shared';
import { z } from 'zod';

/**
 * Bentuk yang diterima dari dashboard saat mengatur integrasi & notifikasi.
 * Validasinya memakai schema dari @formz/shared supaya bentuk yang disimpan di
 * JSONB sama persis dengan yang dibaca worker.
 */

/**
 * Menerima ID maupun URL spreadsheet. Normalisasi dilakukan di sini, bukan di
 * worker, supaya yang tersimpan di database selalu ID — worker tidak perlu tahu
 * bahwa orang biasanya menempelkan URL.
 */
const spreadsheetIdSchema = z
  .string()
  .trim()
  .min(1, 'ID atau URL spreadsheet wajib diisi')
  .max(500)
  .transform((value) => extractSpreadsheetId(value))
  .refine((value) => /^[a-zA-Z0-9-_]{10,}$/.test(value), {
    message: 'ID spreadsheet tidak dikenali. Tempelkan URL spreadsheet-nya, atau ID-nya saja.',
  });

export const upsertGoogleSheetIntegrationSchema = z.object({
  config: googleSheetConfigSchema.extend({ spreadsheetId: spreadsheetIdSchema }),
  isActive: z.boolean().prefault(true),
});
export type UpsertGoogleSheetIntegrationDto = z.infer<typeof upsertGoogleSheetIntegrationSchema>;

export const upsertNotificationRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    trigger: notificationTriggerSchema.prefault('on_submit'),
    subject: z.string().trim().min(1).max(200).prefault(DEFAULT_EMAIL_SUBJECT),
    emailTemplateId: emailTemplateIdSchema.prefault(DEFAULT_EMAIL_TEMPLATE_ID),
    /** NULL/absen = selalu dikirim. */
    condition: conditionGroupSchema.nullable().prefault(null),
    recipients: z.array(z.email('Format email tidak valid')).max(50).prefault([]),
    recipientFieldIds: z.array(z.string().min(1)).max(10).prefault([]),
    recipientRules: recipientRulesSchema.nullable().prefault(null),
    isActive: z.boolean().prefault(true),
  })
  .refine(
    (rule) =>
      rule.recipients.length > 0 ||
      rule.recipientFieldIds.length > 0 ||
      (rule.recipientRules?.rules.length ?? 0) > 0,
    {
      message:
        'Aturan ini belum punya penerima. Isi minimal salah satu: email tetap, field email pengisi, atau penerima bersyarat.',
      path: ['recipients'],
    },
  );
export type UpsertNotificationRuleDto = z.infer<typeof upsertNotificationRuleSchema>;

/**
 * Uji coba boleh diarahkan ke satu alamat saja. Tanpa ini, mencoba aturan yang
 * penerimanya seluruh tim berarti mengirim email percobaan ke seluruh tim.
 */
export const testNotificationSchema = z
  .object({ to: z.email('Format email tidak valid').optional() })
  .prefault({});
export type TestNotificationDto = z.infer<typeof testNotificationSchema>;
