import type { FormSchema, FormStatus, SchemaValidationResult } from '@formz/shared';

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
