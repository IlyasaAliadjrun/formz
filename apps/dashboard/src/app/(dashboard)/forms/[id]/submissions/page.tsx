'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  columnVisibilityFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {
  AlertCircle,
  ArrowLeft,
  Columns3,
  Download,
  FileSpreadsheet,
  Inbox,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { FormTabs } from '@/components/forms/form-tabs';
import { IntegrationStatusBadge } from '@/components/submissions/integration-status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SubmissionColumn, SubmissionRow } from '@/lib/api-types';
import { formatDateTime } from '@/lib/format';
import { useHasPermission } from '@/lib/hooks/use-auth';
import { useExportSubmissions, useSubmissionList } from '@/lib/hooks/use-submissions';

const PER_PAGE = 25;

/**
 * Berapa kolom jawaban yang tampil sebelum pengguna mengaturnya sendiri. Form
 * bisa punya puluhan field; menampilkan semuanya membuat tabel harus digeser
 * menyamping sebelum satu baris pun terbaca.
 */
const DEFAULT_VISIBLE_ANSWER_COLUMNS = 5;

// features, helper, dan data kosong sengaja di luar komponen: TanStack Table
// membandingkan referensinya, dan objek baru tiap render memicu render ulang
// tanpa henti.
const features = tableFeatures({ columnVisibilityFeature });
const helper = createColumnHelper<typeof features, SubmissionRow>();
const EMPTY_ROWS: SubmissionRow[] = [];

export default function SubmissionListPage() {
  const params = useParams<{ id: string }>();
  const formId = params.id;
  const router = useRouter();

  const hasPermission = useHasPermission();
  const canExport = hasPermission('submission.export');

  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters = {
    formId,
    page,
    perPage: PER_PAGE,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const query = useSubmissionList(filters);
  const exportSubmissions = useExportSubmissions();

  const rows = query.data?.data ?? EMPTY_ROWS;
  const meta = query.data?.meta;
  const answerColumns = useMemo(() => query.data?.columns ?? [], [query.data?.columns]);

  const columns = useMemo(() => buildColumns(answerColumns), [answerColumns]);
  const initialState = useMemo(() => defaultVisibility(answerColumns), [answerColumns]);

  const table = useTable(
    {
      features,
      data: rows,
      columns,
      getRowId: (row) => row.id,
      initialState,
    },
    (state) => ({ columnVisibility: state.columnVisibility }),
  );

  const runExport = (format: 'xlsx' | 'csv') =>
    exportSubmissions.mutate(
      { formId, format, ...(from ? { from } : {}), ...(to ? { to } : {}) },
      {
        onSuccess: (result) => {
          toast.success(`${result.rowCount} submission diekspor`, {
            description: result.truncated
              ? 'Hasil dipotong pada batas ekspor. Persempit rentang tanggalnya.'
              : result.filename,
          });
        },
        onError: (error) => toast.error('Ekspor gagal', { description: error.message }),
      },
    );

  const resetFilter = () => {
    setFrom('');
    setTo('');
    setPage(1);
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
              {query.data?.form.title ?? 'Submission'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {meta ? `${meta.total} jawaban masuk` : 'Memuat jawaban…'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <FormTabs formId={formId} />

          {canExport && (
            <>
              <Button
                variant="outline"
                onClick={() => runExport('xlsx')}
                disabled={exportSubmissions.isPending || rows.length === 0}
              >
                {exportSubmissions.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FileSpreadsheet />
                )}
                Excel
              </Button>
              <Button
                variant="outline"
                onClick={() => runExport('csv')}
                disabled={exportSubmissions.isPending || rows.length === 0}
              >
                <Download />
                CSV
              </Button>
            </>
          )}
        </div>
      </header>

      {/* ---------- Filter ---------- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-from" className="text-xs">
            Dari tanggal
          </Label>
          <Input
            id="filter-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            className="w-44"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-to" className="text-xs">
            Sampai tanggal
          </Label>
          <Input
            id="filter-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
            className="w-44"
          />
        </div>

        {(from || to) && (
          <Button variant="ghost" size="sm" onClick={resetFilter}>
            Hapus filter
          </Button>
        )}

        {answerColumns.length > 0 && (
          <details className="relative ml-auto">
            <summary className="border-input hover:bg-accent flex cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm">
              <Columns3 className="size-3.5" />
              Kolom
            </summary>
            <div className="bg-popover absolute right-0 z-20 mt-1 flex max-h-80 w-64 flex-col gap-1 overflow-y-auto rounded-md border p-2 shadow-md">
              {table.getAllColumns().map((column) => (
                <label
                  key={column.id}
                  className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={column.getIsVisible()}
                    onChange={() => column.toggleVisibility()}
                  />
                  <span className="truncate">{headerTextOf(column.id, answerColumns)}</span>
                </label>
              ))}
            </div>
          </details>
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
          <AlertTitle>Gagal memuat submission</AlertTitle>
          <AlertDescription>
            <p>{query.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {query.isLoading && (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && !query.isError && rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Inbox className="text-muted-foreground size-8" />
          <div>
            <p className="font-medium">
              {from || to ? 'Tidak ada submission di rentang itu' : 'Belum ada submission'}
            </p>
            <p className="text-muted-foreground text-sm">
              {from || to
                ? 'Coba perlebar rentang tanggalnya.'
                : 'Jawaban akan muncul di sini begitu ada yang mengisi form.'}
            </p>
          </div>
          {(from || to) && (
            <Button variant="outline" size="sm" onClick={resetFilter}>
              Hapus filter
            </Button>
          )}
        </div>
      )}

      {!query.isLoading && !query.isError && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap">
                        {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>

              <TableBody>
                {table.getRowModel().rows.map((row) => {
                  const href = `/forms/${formId}/submissions/${row.original.id}`;

                  return (
                    <TableRow
                      key={row.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`Buka detail submission ${formatDateTime(row.original.submittedAt)}`}
                      onClick={() => router.push(href)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') router.push(href);
                      }}
                      className="focus-visible:ring-ring cursor-pointer focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="max-w-xs truncate">
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {meta && (
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-sm">
                Halaman {meta.page} dari {meta.totalPages} · {meta.total} submission
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Sebelumnya
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Berikutnya
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Kolom tetap (waktu, versi, integrasi) plus satu kolom per field jawaban.
 *
 * Label kolom diambil dari versi form yang sedang berlaku, sementara isi tiap
 * sel sudah diterjemahkan server memakai schema versi submission itu sendiri.
 */
function buildColumns(answerColumns: SubmissionColumn[]) {
  return helper.columns([
    helper.accessor((row) => row.submittedAt, {
      id: 'submittedAt',
      header: 'Waktu submit',
      cell: (info) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDateTime(info.getValue() as string)}
        </span>
      ),
    }),

    helper.accessor((row) => row.versionNumber, {
      id: 'versionNumber',
      header: 'Versi',
      cell: (info) => (
        <Badge variant="outline" className="tabular-nums">
          v{info.getValue() as number}
        </Badge>
      ),
    }),

    ...answerColumns.map((column) =>
      helper.accessor((row) => row.values[column.fieldId] ?? '', {
        id: column.fieldId,
        header: column.label,
        cell: (info) => {
          const value = info.getValue() as string;

          return value ? (
            <span title={value}>{value}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      }),
    ),

    helper.display({
      id: 'integrations',
      header: 'Integrasi',
      cell: (info) => {
        const { sheet, email } = info.row.original.integrations;

        return (
          <div className="flex flex-wrap items-center gap-1">
            <IntegrationStatusBadge status={sheet} label={sheetLabel(sheet)} />
            <IntegrationStatusBadge status={email} label={emailLabel(email)} />
          </div>
        );
      },
    }),
  ]);
}

/** Semua kolom jawaban di luar N pertama disembunyikan sampai pengguna memilihnya. */
function defaultVisibility(answerColumns: SubmissionColumn[]) {
  const hidden = answerColumns
    .slice(DEFAULT_VISIBLE_ANSWER_COLUMNS)
    .map((column) => [column.fieldId, false] as const);

  return { columnVisibility: Object.fromEntries(hidden) };
}

function headerTextOf(columnId: string, answerColumns: SubmissionColumn[]): string {
  const FIXED: Record<string, string> = {
    submittedAt: 'Waktu submit',
    versionNumber: 'Versi',
    integrations: 'Integrasi',
  };

  return (
    FIXED[columnId] ??
    answerColumns.find((column) => column.fieldId === columnId)?.label ??
    columnId
  );
}

/**
 * Di daftar, dua lencana berdiri berdampingan tanpa judul kolom per jenis, jadi
 * masing-masing menyebut jenisnya sendiri — kalau tidak, "Gagal" di sebelah
 * "Gagal" tidak memberi tahu mana yang spreadsheet dan mana yang email.
 */
function statusLabel(kind: 'Sheet' | 'Email', status: string | null): string {
  const WORD: Record<string, string> = {
    success: kind === 'Sheet' ? 'masuk' : 'terkirim',
    failed: 'gagal',
    pending: 'menunggu',
  };

  return `${kind}: ${status ? WORD[status] : 'belum'}`;
}

const sheetLabel = (status: string | null) => statusLabel('Sheet', status);
const emailLabel = (status: string | null) => statusLabel('Email', status);
