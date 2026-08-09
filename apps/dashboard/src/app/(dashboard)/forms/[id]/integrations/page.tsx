'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EMAIL_TEMPLATES, type FormSchema } from '@formz/shared';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Send,
  Sheet as SheetIcon,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { NotificationRuleDialog } from '@/components/integrations/notification-rule-dialog';
import { SheetIntegrationDialog } from '@/components/integrations/sheet-integration-dialog';
import { CopyButton } from '@/components/forms/copy-button';
import { FormTabs } from '@/components/forms/form-tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { API_URL } from '@/lib/api-client';
import type { NotificationRule, SheetIntegration } from '@/lib/api-types';
import { useHasPermission } from '@/lib/hooks/use-auth';
import { useForm } from '@/lib/hooks/use-forms';
import {
  useDeleteNotificationRule,
  useDeleteSheetIntegration,
  useIntegrationSettings,
  useQueueSummary,
  useTestNotificationRule,
  useTestSheetIntegration,
} from '@/lib/hooks/use-integrations';

/**
 * Halaman pengaturan integrasi & notifikasi satu form.
 *
 * Dua hal yang membedakannya dari halaman pengaturan biasa: kredensial Google
 * ada di server, jadi halaman ini menampilkan alamat service account yang harus
 * dibagikan admin ke spreadsheet-nya; dan setiap target punya tombol uji coba
 * yang benar-benar menjalankan job lewat antrean, bukan sekadar memvalidasi isian.
 */
export default function IntegrationsPage() {
  const params = useParams<{ id: string }>();
  const formId = params.id;

  const hasPermission = useHasPermission();
  const canManage = hasPermission('integration.manage');

  const settings = useIntegrationSettings(formId);
  const form = useForm(formId);

  const [sheetDialog, setSheetDialog] = useState<{ open: boolean; value: SheetIntegration | null }>(
    { open: false, value: null },
  );
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; value: NotificationRule | null }>({
    open: false,
    value: null,
  });

  if (!canManage) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Tidak punya akses</AlertTitle>
          <AlertDescription>
            {/* Dibungkus <p>: AlertDescription memakai grid, jadi teks dan <code>
                yang berdampingan akan jatuh ke baris masing-masing tanpa ini. */}
            <p>
              Mengatur integrasi butuh permission <code>integration.manage</code>.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (settings.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (settings.isError) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat pengaturan integrasi</AlertTitle>
          <AlertDescription>
            <p>{settings.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void settings.refetch()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const data = settings.data;
  if (!data) return null;

  // Daftar field untuk memilih kolom & penerima diambil dari **draft**, bukan
  // versi terpublish: kalau seseorang baru menambahkan field lalu langsung
  // membuka halaman ini, field itu harus sudah bisa dipilih.
  const schema: FormSchema | null = form.data?.draftSchema ?? null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild aria-label="Kembali ke daftar form">
            <Link href="/forms">
              <ArrowLeft />
            </Link>
          </Button>

          <div>
            <h1 className="text-xl font-semibold tracking-tight">Integrasi & Notifikasi</h1>
            <p className="text-muted-foreground text-sm">
              {form.data?.title ?? 'Form'} — spreadsheet dan email otomatis untuk setiap submission
            </p>
          </div>
        </div>

        <FormTabs formId={formId} />
      </header>

      <GoogleSheetsCard
        formId={formId}
        integrations={data.integrations}
        google={data.google}
        onAdd={() => setSheetDialog({ open: true, value: null })}
        onEdit={(integration) => setSheetDialog({ open: true, value: integration })}
      />

      <NotificationCard
        formId={formId}
        rules={data.notificationRules}
        mail={data.mail}
        onAdd={() => setRuleDialog({ open: true, value: null })}
        onEdit={(rule) => setRuleDialog({ open: true, value: rule })}
      />

      <QueueCard />

      {sheetDialog.open && (
        <SheetIntegrationDialog
          // key memaksa state formulir dibuat ulang saat berpindah antar target;
          // tanpa itu isian target sebelumnya ikut terbawa.
          key={sheetDialog.value?.id ?? 'baru'}
          formId={formId}
          schema={schema}
          integration={sheetDialog.value}
          open
          onOpenChange={(open) => setSheetDialog({ open, value: open ? sheetDialog.value : null })}
        />
      )}

      {ruleDialog.open && (
        <NotificationRuleDialog
          key={ruleDialog.value?.id ?? 'baru'}
          formId={formId}
          schema={schema}
          rule={ruleDialog.value}
          open
          onOpenChange={(open) => setRuleDialog({ open, value: open ? ruleDialog.value : null })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Google Sheets
// ---------------------------------------------------------------------------

function GoogleSheetsCard({
  formId,
  integrations,
  google,
  onAdd,
  onEdit,
}: {
  formId: string;
  integrations: SheetIntegration[];
  google: { configured: boolean; serviceAccountEmail: string | null };
  onAdd: () => void;
  onEdit: (integration: SheetIntegration) => void;
}) {
  const remove = useDeleteSheetIntegration(formId);
  const test = useTestSheetIntegration(formId);
  const [testing, setTesting] = useState<string | null>(null);

  const runTest = (integration: SheetIntegration) => {
    setTesting(integration.id);
    test.mutate(integration.id, {
      onSuccess: (result) => {
        toast.success(
          result.status === 'synced'
            ? `Baris contoh masuk ke "${result.sheetName}"${result.updatedRange ? ` (${result.updatedRange})` : ''}`
            : 'Baris ini sudah pernah masuk sebelumnya',
        );
      },
      onError: (error) => toast.error(error.message, { duration: 12_000 }),
      onSettled: () => setTesting(null),
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <SheetIcon className="text-muted-foreground size-4" />
              Google Sheets
            </CardTitle>
            <CardDescription>
              Setiap submission ditulis sebagai satu baris baru, lewat antrean di belakang layar.
            </CardDescription>
          </div>

          <Button size="sm" onClick={onAdd} disabled={!google.configured}>
            <Plus />
            Tambah target
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Alamat service account bukan rahasia; justru harus dibagikan admin
            ke spreadsheet tujuan, dan tanpa itu sync selalu gagal dengan 403. */}
        {google.configured ? (
          <Alert>
            <CheckCircle2 />
            <AlertTitle>Bagikan spreadsheet ke alamat ini</AlertTitle>
            <AlertDescription>
              <p>
                Buka spreadsheet tujuan → <strong>Share</strong> → tambahkan alamat berikut sebagai{' '}
                <strong>Editor</strong>. Tanpa langkah ini Formz tidak bisa menulis ke sana.
              </p>
              <div className="flex w-full items-center gap-2">
                <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-xs">
                  {google.serviceAccountEmail}
                </code>
                <CopyButton value={google.serviceAccountEmail ?? ''} label="Salin alamat" />
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="warning">
            <AlertCircle />
            <AlertTitle>Kredensial Google belum diatur di server</AlertTitle>
            <AlertDescription>
              <p>
                Isi <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code> dan <code>GOOGLE_PRIVATE_KEY</code> di
                berkas <code>.env</code>, lalu jalankan ulang service api dan worker.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {integrations.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
            Belum ada spreadsheet tujuan untuk form ini.
          </p>
        ) : (
          integrations.map((integration) => (
            <div key={integration.id} className="flex flex-col gap-3 rounded-md border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{integration.config.sheetName}</span>
                    {!integration.isActive && <Badge variant="outline">Nonaktif</Badge>}
                  </div>
                  <code className="text-muted-foreground block truncate text-xs">
                    {integration.config.spreadsheetId}
                  </code>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={integration.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink />
                      Buka
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runTest(integration)}
                    disabled={testing !== null || !google.configured}
                  >
                    {testing === integration.id ? <Loader2 className="animate-spin" /> : <Send />}
                    Test Kirim
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Ubah"
                    onClick={() => onEdit(integration)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Hapus"
                    onClick={() => {
                      if (!confirm(`Hapus target "${integration.config.sheetName}"?`)) return;

                      remove.mutate(integration.id, {
                        onSuccess: () => toast.success('Target spreadsheet dihapus'),
                        onError: (error) => toast.error(error.message),
                      });
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <p className="text-muted-foreground text-xs">
                {integration.config.fieldIds.length === 0
                  ? 'Semua field jawaban ikut ditulis'
                  : `${integration.config.fieldIds.length} field dipilih`}
                {integration.config.metaColumns.length > 0 &&
                  ` · metadata: ${integration.config.metaColumns.join(', ')}`}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notifikasi email
// ---------------------------------------------------------------------------

function NotificationCard({
  formId,
  rules,
  mail,
  onAdd,
  onEdit,
}: {
  formId: string;
  rules: NotificationRule[];
  mail: { configured: boolean; provider: string; from: string | null };
  onAdd: () => void;
  onEdit: (rule: NotificationRule) => void;
}) {
  const remove = useDeleteNotificationRule(formId);
  const test = useTestNotificationRule(formId);
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState<string | null>(null);

  const runTest = (rule: NotificationRule) => {
    setTesting(rule.id);
    test.mutate(
      { ruleId: rule.id, to: testEmail.trim() || undefined },
      {
        onSuccess: (result) => {
          const sent = result.deliveries.filter((item) => item.status === 'sent');
          const failed = result.deliveries.filter((item) => item.status === 'failed');

          if (failed.length > 0) {
            toast.error(`Gagal ke ${failed.map((item) => item.recipient).join(', ')}`, {
              description: failed[0]?.error ?? undefined,
              duration: 12_000,
            });

            return;
          }

          toast.success(`Terkirim ke ${sent.map((item) => item.recipient).join(', ')}`, {
            description: `Subjek: ${result.subject}`,
          });
        },
        onError: (error) => toast.error(error.message, { duration: 12_000 }),
        onSettled: () => setTesting(null),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="text-muted-foreground size-4" />
              Notifikasi email
            </CardTitle>
            <CardDescription>
              Email otomatis saat submission masuk, dengan penerima tetap maupun bersyarat.
            </CardDescription>
          </div>

          <Button size="sm" onClick={onAdd}>
            <Plus />
            Tambah aturan
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {mail.provider === 'console' ? (
          <Alert variant="warning">
            <AlertCircle />
            <AlertTitle>Email belum benar-benar dikirim</AlertTitle>
            <AlertDescription>
              <p>
                Server sedang memakai provider <code>console</code> — isi email hanya dicetak ke log
                worker. Isi <code>MAIL_PROVIDER=smtp</code> beserta <code>SMTP_HOST</code> dan{' '}
                <code>MAIL_FROM</code> untuk mengirim sungguhan.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground text-xs">
            Dikirim lewat <code>{mail.provider}</code>
            {mail.from ? ` sebagai ${mail.from}` : ''}.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="test-email" className="text-sm font-medium">
            Alamat tujuan uji coba
          </label>
          <Input
            id="test-email"
            type="email"
            value={testEmail}
            onChange={(event) => setTestEmail(event.target.value)}
            placeholder="kamu@example.com"
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">
            Tombol Test Kirim mengirim ke alamat ini saja. Kalau dikosongkan, email uji coba dikirim
            ke seluruh email tetap milik aturan tersebut.
          </p>
        </div>

        {rules.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
            Belum ada aturan notifikasi untuk form ini.
          </p>
        ) : (
          rules.map((rule) => (
            <div key={rule.id} className="flex flex-col gap-3 rounded-md border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{rule.name ?? 'Tanpa nama'}</span>
                    {!rule.isActive && <Badge variant="outline">Nonaktif</Badge>}
                    {rule.condition && <Badge variant="outline">Bersyarat</Badge>}
                    <Badge variant="secondary">
                      {EMAIL_TEMPLATES.find((template) => template.id === rule.emailTemplateId)
                        ?.name ?? rule.emailTemplateId}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground truncate text-xs">{rule.subject}</p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runTest(rule)}
                    disabled={testing !== null}
                  >
                    {testing === rule.id ? <Loader2 className="animate-spin" /> : <Send />}
                    Test Kirim
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Ubah"
                    onClick={() => onEdit(rule)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Hapus"
                    onClick={() => {
                      if (!confirm(`Hapus aturan "${rule.name ?? 'tanpa nama'}"?`)) return;

                      remove.mutate(rule.id, {
                        onSuccess: () => toast.success('Aturan notifikasi dihapus'),
                        onError: (error) => toast.error(error.message),
                      });
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <p className="text-muted-foreground text-xs">{describeRecipients(rule)}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function describeRecipients(rule: NotificationRule): string {
  const parts: string[] = [];

  if (rule.recipients.length > 0) parts.push(rule.recipients.join(', '));
  if (rule.recipientFieldIds.length > 0) {
    parts.push(`${rule.recipientFieldIds.length} field email pengisi`);
  }
  if (rule.recipientRules?.rules.length) {
    parts.push(`${rule.recipientRules.rules.length} penerima bersyarat`);
  }

  return parts.length > 0 ? `Penerima: ${parts.join(' · ')}` : 'Belum ada penerima';
}

// ---------------------------------------------------------------------------
// Antrean
// ---------------------------------------------------------------------------

/**
 * Ringkasan antrean. Bull Board sendiri punya autentikasi terpisah (HTTP Basic),
 * jadi yang ditampilkan di sini cukup untuk tahu ada tidaknya job yang gagal
 * tanpa harus membukanya.
 */
function QueueCard() {
  const summary = useQueueSummary();
  const failed = summary.data?.queues.reduce((total, queue) => total + queue.failed, 0) ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Antrean job</CardTitle>
        <CardDescription>
          Sync spreadsheet dan pengiriman email dikerjakan di belakang layar, dengan percobaan ulang
          otomatis kalau gagal sementara.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {summary.isError && (
          <p className="text-muted-foreground text-sm">Status antrean tidak bisa dibaca.</p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {summary.data?.queues.map((queue) => (
            <div key={queue.name} className="rounded-md border p-3">
              <p className="font-mono text-xs">{queue.name}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {queue.waiting} menunggu · {queue.active} berjalan · {queue.delayed} tertunda ·{' '}
                <span className={queue.failed > 0 ? 'text-destructive font-medium' : undefined}>
                  {queue.failed} gagal
                </span>
              </p>
            </div>
          ))}
        </div>

        {failed > 0 && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Ada {failed} job yang gagal</AlertTitle>
            <AlertDescription>
              Buka halaman pemantauan antrean untuk melihat pesan errornya, atau jalankan ulang dari
              halaman detail submission yang bersangkutan.
            </AlertDescription>
          </Alert>
        )}

        {summary.data?.boardPath ? (
          <Button variant="outline" size="sm" asChild className="w-fit">
            <a
              href={`${API_URL}${summary.data.boardPath}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink />
              Buka pemantauan antrean
            </a>
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">
            Halaman pemantauan antrean tidak aktif. Isi <code>QUEUE_DASHBOARD_USER</code> dan{' '}
            <code>QUEUE_DASHBOARD_PASSWORD</code> di <code>.env</code> untuk mengaktifkannya.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
