'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { ReportGranularity } from '@formz/shared';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { FormTabs } from '@/components/forms/form-tabs';
import { DistributionChart } from '@/components/reports/distribution-chart';
import { IntegrationStats } from '@/components/reports/integration-stats';
import { TrendChart } from '@/components/reports/trend-chart';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useExportReport, useRefreshReports, useReportOverview } from '@/lib/hooks/use-reports';

/**
 * Halaman laporan satu form.
 *
 * Angkanya datang dari materialized view yang di-refresh berkala, jadi bagian
 * "Data dihitung …" bukan hiasan: tanpa itu, form yang baru menerima kiriman
 * tampil dengan angka lama dan tidak ada yang bisa dilakukan pembacanya selain
 * bingung. Yang ditampilkan karena itu waktu perhitungan terakhir, berapa
 * submission yang belum ikut terhitung, dan satu tombol untuk memaksa hitung ulang.
 */
export default function ReportsPage() {
  const params = useParams<{ id: string }>();
  const formId = params.id;

  const [granularity, setGranularity] = useState<ReportGranularity>('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters = {
    formId,
    granularity,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const query = useReportOverview(filters);
  const exportReport = useExportReport();
  const refresh = useRefreshReports();

  const report = query.data;

  const runExport = () =>
    exportReport.mutate(filters, {
      onSuccess: (result) => toast.success('Laporan diekspor', { description: result.filename }),
      onError: (error) => toast.error('Ekspor gagal', { description: error.message }),
    });

  const runRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(result.queued ? 'Perhitungan ulang diantrekan' : 'Sudah berjalan', {
          description: result.message,
        });
        // Job-nya asinkron. Memuat ulang seketika hanya mengambil angka lama
        // yang sama persis, jadi ditunggu sebentar dulu.
        setTimeout(() => void query.refetch(), 4_000);
      },
      onError: (error) =>
        toast.error('Gagal meminta perhitungan ulang', {
          description: error.message,
        }),
    });

  const resetFilter = () => {
    setFrom('');
    setTo('');
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild aria-label="Kembali ke daftar form">
            <Link href="/forms">
              <ArrowLeft />
            </Link>
          </Button>

          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {report?.form.title ?? 'Laporan'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {report
                ? `${report.totals.submissions} submission di rentang ini`
                : 'Memuat laporan…'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <FormTabs formId={formId} />

          <Button
            variant="outline"
            onClick={runExport}
            disabled={exportReport.isPending || !report}
            title="Unduh laporan sebagai berkas Excel"
          >
            {exportReport.isPending ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            Ekspor Excel
          </Button>
        </div>
      </header>

      {/* ---------- Filter ---------- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-from" className="text-xs">
            Dari tanggal
          </Label>
          <Input
            id="report-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            className="w-44"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-to" className="text-xs">
            Sampai tanggal
          </Label>
          <Input
            id="report-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            className="w-44"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-granularity" className="text-xs">
            Kelompokkan tren
          </Label>
          <NativeSelect
            id="report-granularity"
            value={granularity}
            onChange={(event) => setGranularity(event.target.value as ReportGranularity)}
            className="w-44"
          >
            <option value="day">Per hari</option>
            <option value="week">Per minggu</option>
          </NativeSelect>
        </div>

        {(from || to) && (
          <Button variant="ghost" size="sm" onClick={resetFilter}>
            Hapus filter
          </Button>
        )}

        {query.isFetching && !query.isLoading && (
          <span className="text-muted-foreground flex items-center gap-2 text-sm">
            <RefreshCw className="size-3.5 animate-spin" />
            Memuat ulang
          </span>
        )}
      </div>

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat laporan</AlertTitle>
          <AlertDescription>
            <p>{query.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {query.isLoading && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-80 w-full" />
        </div>
      )}

      {report && (
        <>
          {/* ---------- Kesegaran data ---------- */}
          <FreshnessNotice report={report} pending={refresh.isPending} onRefresh={runRefresh} />

          {/* ---------- Ringkasan ---------- */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Total submission"
              value={report.totals.submissions.toLocaleString('id-ID')}
              hint={
                report.range.from || report.range.to
                  ? 'Dalam rentang yang dipilih'
                  : 'Sejak form dibuat'
              }
            />
            <SummaryCard
              label="Hari aktif"
              value={report.totals.activeDays.toLocaleString('id-ID')}
              hint="Hari yang benar-benar ada kirimannya"
            />
            <SummaryCard
              label="Rata-rata per hari aktif"
              value={report.totals.averagePerActiveDay.toLocaleString('id-ID')}
              hint="Bukan rata-rata per hari kalender"
            />
            <SummaryCard
              label="Submission terakhir"
              value={
                report.totals.lastSubmissionAt
                  ? formatRelative(report.totals.lastSubmissionAt)
                  : '—'
              }
              hint={
                report.totals.lastSubmissionAt
                  ? formatDateTime(report.totals.lastSubmissionAt)
                  : 'Belum ada kiriman'
              }
            />
          </div>

          {/* ---------- Tren ---------- */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Tren submission {report.range.granularity === 'week' ? 'per minggu' : 'per hari'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart points={report.trend} granularity={report.range.granularity} />
            </CardContent>
          </Card>

          {/* ---------- Status integrasi ---------- */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status integrasi</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-8 sm:grid-cols-2">
              <IntegrationStats
                stat={report.integrations.sheet}
                title="Sinkronisasi spreadsheet"
                description="Satu catatan per submission per integrasi spreadsheet."
                emptyLabel="Belum ada submission yang disinkronkan ke spreadsheet."
              />
              <IntegrationStats
                stat={report.integrations.email}
                title="Notifikasi email"
                description="Satu catatan per alamat penerima per submission."
                emptyLabel="Belum ada notifikasi email yang dikirim."
              />
            </CardContent>
          </Card>

          {/* ---------- Distribusi jawaban ---------- */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="text-muted-foreground size-4" />
              <h2 className="text-base font-semibold">Distribusi jawaban</h2>
            </div>

            {report.distributions.length === 0 ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
                Form ini belum punya field bertipe dropdown, radio, pilihan ganda, atau checkbox —
                jadi belum ada yang bisa dihitung sebarannya.
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {report.distributions.map((distribution) => (
                  <Card key={distribution.fieldId}>
                    <CardHeader className="flex flex-row items-start justify-between gap-3">
                      <CardTitle className="text-base">{distribution.label}</CardTitle>
                      <Badge variant="outline" className="shrink-0">
                        {distribution.respondents} penjawab
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      <DistributionChart distribution={distribution} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-6">
        <p className="text-muted-foreground text-sm">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Keterangan "data per kapan" beserta tombol hitung ulang.
 *
 * Tiga keadaan yang sengaja dibedakan: refresh terakhir gagal (merah, ada yang
 * perlu diperiksa), ada submission yang belum terhitung (kuning, wajar dan
 * bisa dipercepat), dan semuanya sudah terhitung (abu-abu, sekadar keterangan).
 */
function FreshnessNotice({
  report,
  pending,
  onRefresh,
}: {
  report: {
    freshness: {
      refreshedAt: string | null;
      pendingSubmissions: number;
      errorMessage: string | null;
    };
  };
  pending: boolean;
  onRefresh: () => void;
}) {
  const { refreshedAt, pendingSubmissions, errorMessage } = report.freshness;

  const button = (
    <Button variant="outline" size="sm" onClick={onRefresh} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      Hitung ulang sekarang
    </Button>
  );

  if (errorMessage) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Perhitungan terakhir gagal</AlertTitle>
        <AlertDescription>
          <p>
            Angka di halaman ini mungkin belum mencakup kiriman terbaru. Pesan dari database:{' '}
            {errorMessage}
          </p>
          {button}
        </AlertDescription>
      </Alert>
    );
  }

  if (pendingSubmissions > 0) {
    return (
      <Alert variant="warning">
        <AlertCircle />
        <AlertDescription>
          <p>
            {pendingSubmissions} submission masuk setelah perhitungan terakhir dan belum ikut
            terhitung di halaman ini. Angka akan menyesuaikan sendiri pada perhitungan berkala
            berikutnya.
          </p>
          {button}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
      <span>
        {refreshedAt
          ? `Data dihitung ${formatRelative(refreshedAt)} (${formatDateTime(refreshedAt)})`
          : 'Data belum pernah dihitung ulang sejak laporan diaktifkan.'}
      </span>
      {button}
    </div>
  );
}
