'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  Globe,
  History,
  Mail,
  Sheet as SheetIcon,
} from 'lucide-react';
import { FormTabs } from '@/components/forms/form-tabs';
import { IntegrationStatusBadge } from '@/components/submissions/integration-status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import type { SubmissionAnswerEntry, SubmissionDetail } from '@/lib/api-types';
import { formatDateTime } from '@/lib/format';
import { useSubmission } from '@/lib/hooks/use-submissions';

export default function SubmissionDetailPage() {
  const params = useParams<{ id: string; submissionId: string }>();
  const formId = params.id;
  const query = useSubmission(params.submissionId);

  if (query.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat submission</AlertTitle>
          <AlertDescription>
            <p>{query.error.message}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Coba lagi
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/forms/${formId}/submissions`}>Kembali ke daftar</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const submission = query.data;
  if (!submission) return null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild aria-label="Kembali ke daftar submission">
            <Link href={`/forms/${formId}/submissions`}>
              <ArrowLeft />
            </Link>
          </Button>

          <div>
            <h1 className="text-xl font-semibold tracking-tight">Detail Submission</h1>
            <p className="text-muted-foreground text-sm">
              {submission.form.title} · {formatDateTime(submission.submittedAt)}
            </p>
          </div>
        </div>

        <FormTabs formId={formId} />
      </header>

      {/* Kalau form sudah berubah setelah jawaban ini masuk, pembaca harus tahu
          bahwa yang dilihatnya bentuk form yang lama — bukan yang sekarang. */}
      {!submission.version.isLatest && (
        <Alert variant="warning">
          <History />
          <AlertTitle>
            Ditampilkan dengan schema versi {submission.version.versionNumber}
          </AlertTitle>
          <AlertDescription>
            Form ini sudah diubah setelah jawaban masuk. Label field dan pilihan di bawah adalah
            yang dilihat pengisi saat itu, jadi bisa berbeda dari form yang berlaku sekarang.
          </AlertDescription>
        </Alert>
      )}

      {/* ---------- Metadata ---------- */}
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Waktu submit" value={formatDateTime(submission.submittedAt)} />
          <Meta label="Versi form" value={`v${submission.version.versionNumber}`} />
          <Meta
            label="Domain sumber"
            value={submission.sourceDomain ?? 'Dibuka langsung'}
            Icon={Globe}
          />
          <Meta label="Alamat IP" value={submission.ipAddress ?? '—'} />
        </CardContent>
      </Card>

      {/* ---------- Jawaban ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jawaban</CardTitle>
          <CardDescription>
            Ditampilkan mengikuti urutan field pada versi form saat jawaban ini dikirim.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col">
          {submission.entries.length === 0 && (
            <p className="text-muted-foreground text-sm">Tidak ada field jawaban di versi ini.</p>
          )}

          {submission.entries.map((entry, index) => (
            <div key={entry.fieldId}>
              {index > 0 && <Separator />}
              <AnswerRow entry={entry} />
            </div>
          ))}
        </CardContent>
      </Card>

      <IntegrationSection integrations={submission.integrations} />
    </div>
  );
}

function AnswerRow({ entry }: { entry: SubmissionAnswerEntry }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{entry.label}</span>
        <span className="text-muted-foreground font-mono text-[11px]">{entry.name}</span>
        {entry.orphan && (
          <Badge variant="outline" className="w-fit text-amber-600 dark:text-amber-400">
            Field tidak ada di versi ini
          </Badge>
        )}
      </div>

      <div className="sm:col-span-2">
        {entry.answered ? (
          <p className="text-sm break-words whitespace-pre-wrap">{entry.display}</p>
        ) : (
          <p className="text-muted-foreground text-sm italic">
            {/* Checkbox tidak dicentang tetap punya arti, jadi teksnya ikut tampil. */}
            {entry.display || 'Tidak diisi'}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * "Status Integrasi": apa yang sudah terjadi pada jawaban ini di luar database —
 * baris spreadsheet dan email notifikasi. Menjawab pertanyaan yang jadi alasan
 * queue dipakai sejak awal (ARCHITECTURE.md bagian 3.5): sudah masuk sheet atau
 * belum, dan email-nya terkirim ke siapa saja.
 */
function IntegrationSection({ integrations }: { integrations: SubmissionDetail['integrations'] }) {
  const { sheet, email } = integrations;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Status Integrasi</CardTitle>
        <CardDescription>
          Hasil sinkronisasi spreadsheet dan pengiriman email untuk submission ini.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* ---------- Spreadsheet ---------- */}
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <SheetIcon className="text-muted-foreground size-4" />
            Google Sheets
          </h3>

          {!sheet.configured ? (
            <p className="text-muted-foreground rounded-md border border-dashed px-4 py-3 text-sm">
              Form ini belum punya integrasi spreadsheet.
            </p>
          ) : (
            sheet.targets.map((target) => (
              <div key={target.integrationId} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <IntegrationStatusBadge
                      status={target.status}
                      label={target.status === 'success' ? 'Sudah masuk' : undefined}
                    />
                    {target.sheetName && (
                      <span className="text-muted-foreground text-sm">
                        Sheet <span className="font-medium">{target.sheetName}</span>
                      </span>
                    )}
                  </div>

                  {target.url && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={target.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink />
                        Buka spreadsheet
                      </a>
                    </Button>
                  )}
                </div>

                {target.syncedAt && (
                  <p className="text-muted-foreground text-xs">
                    Tersinkron {formatDateTime(target.syncedAt)}
                  </p>
                )}

                {target.retryCount > 0 && (
                  <p className="text-muted-foreground text-xs">
                    Sudah dicoba ulang {target.retryCount} kali
                  </p>
                )}

                {target.errorMessage && (
                  <p className="text-destructive text-xs break-words">{target.errorMessage}</p>
                )}
              </div>
            ))
          )}
        </section>

        {/* ---------- Email ---------- */}
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Mail className="text-muted-foreground size-4" />
            Notifikasi email
          </h3>

          {!email.configured && email.recipients.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed px-4 py-3 text-sm">
              Form ini belum punya aturan notifikasi email.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {email.recipients.map((recipient) => (
                <li
                  key={recipient.target}
                  className="flex flex-col gap-1 rounded-md border px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm break-all">{recipient.target}</span>
                    <IntegrationStatusBadge
                      status={recipient.status}
                      label={recipient.status === 'success' ? 'Terkirim' : undefined}
                    />
                  </div>

                  {recipient.syncedAt && (
                    <span className="text-muted-foreground text-xs">
                      Dikirim {formatDateTime(recipient.syncedAt)}
                    </span>
                  )}

                  {recipient.errorMessage && (
                    <span className="text-destructive text-xs break-words">
                      {recipient.errorMessage}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function Meta({ label, value, Icon }: { label: string; value: string; Icon?: typeof Globe }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="flex items-center gap-1.5 text-sm break-words">
        {Icon && <Icon className="text-muted-foreground size-3.5 shrink-0" />}
        {value}
      </span>
    </div>
  );
}
