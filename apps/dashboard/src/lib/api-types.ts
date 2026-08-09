import type {
  ConditionGroup,
  EmailTemplateId,
  FormSchema,
  FormStatus,
  GoogleSheetConfig,
  RecipientRules,
  SchemaValidationResult,
  SheetMetaColumnKey,
} from '@formz/shared';

/** Bentuk respons endpoint /admin/forms — cerminan FormsService di apps/api. */

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface FormSummary {
  id: string;
  formKey: string;
  title: string;
  description: string | null;
  status: FormStatus;
  allowedDomains: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string; email: string } | null;
  submissionCount: number;
  publishedVersion: { id: string; versionNumber: number; publishedAt: string } | null;
  hasUnpublishedChanges: boolean;
}

export interface FormDetail extends FormSummary {
  draftSchema: FormSchema;
  validation: SchemaValidationResult;
}

export interface DeleteFormResult {
  deleted: boolean;
  status: FormStatus | null;
  message: string;
}

/** Bentuk respons /admin/submissions — cerminan SubmissionsService di apps/api. */

export interface SubmissionColumn {
  fieldId: string;
  name: string;
  label: string;
  type: string;
}

export type IntegrationStatus = 'success' | 'failed' | 'pending';

export interface SubmissionRow {
  id: string;
  submittedAt: string;
  formVersionId: string;
  versionNumber: number;
  sourceDomain: string | null;
  /** Teks siap tampil per kolom, dikunci dengan field id. */
  values: Record<string, string>;
  integrations: { sheet: IntegrationStatus | null; email: IntegrationStatus | null };
}

export interface SubmissionListResult {
  data: SubmissionRow[];
  meta: PaginationMeta;
  columns: SubmissionColumn[];
  form: { id: string; title: string; status: FormStatus };
}

export interface SubmissionAnswerEntry {
  fieldId: string;
  name: string;
  label: string;
  type: string;
  value: unknown;
  display: string;
  answered: boolean;
  /** Jawaban tanpa field pasangannya di versi schema tersebut. */
  orphan: boolean;
}

export interface SheetIntegrationStatus {
  integrationId: string;
  spreadsheetId: string | null;
  sheetName: string | null;
  url: string | null;
  status: IntegrationStatus;
  retryCount: number;
  errorMessage: string | null;
  syncedAt: string | null;
}

export interface EmailRecipientStatus {
  target: string;
  status: IntegrationStatus;
  retryCount: number;
  errorMessage: string | null;
  syncedAt: string | null;
}

export interface SubmissionDetail {
  id: string;
  submittedAt: string;
  ipAddress: string | null;
  sourceDomain: string | null;
  form: { id: string; title: string; formKey: string; status: FormStatus };
  version: {
    id: string;
    versionNumber: number;
    publishedAt: string | null;
    /** False berarti form sudah berubah setelah submission ini masuk. */
    isLatest: boolean;
  };
  entries: SubmissionAnswerEntry[];
  integrations: {
    sheet: { configured: boolean; targets: SheetIntegrationStatus[] };
    email: {
      configured: boolean;
      expectedRecipients: string[];
      recipients: EmailRecipientStatus[];
    };
  };
}

// ---------------------------------------------------------------------------
// Integrasi & notifikasi (Part 7)
// ---------------------------------------------------------------------------

export interface SheetIntegration {
  id: string;
  formId: string;
  type: 'google_sheet';
  isActive: boolean;
  config: GoogleSheetConfig;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRule {
  id: string;
  formId: string;
  name: string | null;
  trigger: string;
  subject: string;
  emailTemplateId: EmailTemplateId;
  condition: ConditionGroup | null;
  recipients: string[];
  recipientFieldIds: string[];
  recipientRules: RecipientRules | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Semua yang dibutuhkan halaman pengaturan integrasi, dalam satu request. */
export interface IntegrationSettings {
  integrations: SheetIntegration[];
  notificationRules: NotificationRule[];
  google: { configured: boolean; serviceAccountEmail: string | null };
  mail: { configured: boolean; provider: string; from: string | null };
  emailTemplates: ReadonlyArray<{ id: EmailTemplateId; name: string; description: string }>;
  sheetMetaColumns: ReadonlyArray<{ key: SheetMetaColumnKey; label: string }>;
}

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface QueueSummary {
  queues: QueueCounts[];
  /** Null kalau kredensial Bull Board belum diatur di server. */
  boardPath: string | null;
}

export interface DispatchSummary {
  sheetJobs: number;
  emailJobs: number;
  skipped: string[];
}
