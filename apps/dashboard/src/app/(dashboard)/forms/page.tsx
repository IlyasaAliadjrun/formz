'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormStatus } from '@formz/shared';
import { AlertCircle, Code2, FileText, Inbox, RefreshCw, Search } from 'lucide-react';
import { CreateFormDialog } from '@/components/forms/create-form-dialog';
import { FormStatusBadge } from '@/components/forms/form-status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useHasPermission } from '@/lib/hooks/use-auth';
import { useFormList } from '@/lib/hooks/use-forms';

const PER_PAGE = 20;

export default function FormListPage() {
  const router = useRouter();
  const hasPermission = useHasPermission();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<FormStatus | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const query = useFormList({
    page,
    perPage: PER_PAGE,
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
  });

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const forms = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Form</h1>
          <p className="text-muted-foreground text-sm">
            Kelola form, susun field-nya, dan atur di mana form boleh di-embed.
          </p>
        </div>

        {hasPermission('form.create') && <CreateFormDialog />}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Cari judul form"
              className="w-64 pl-8"
              aria-label="Cari judul form"
            />
          </div>
          <Button type="submit" variant="outline">
            Cari
          </Button>
        </form>

        <NativeSelect
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as FormStatus | '');
            setPage(1);
          }}
          className="w-44"
          aria-label="Filter status"
        >
          <option value="">Semua status</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Diarsipkan</option>
        </NativeSelect>

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
          <AlertTitle>Gagal memuat daftar form</AlertTitle>
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
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && !query.isError && forms.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <FileText className="text-muted-foreground size-8" />
          <div>
            <p className="font-medium">
              {search || status ? 'Tidak ada form yang cocok' : 'Belum ada form'}
            </p>
            <p className="text-muted-foreground text-sm">
              {search || status
                ? 'Coba ubah kata kunci atau filter statusnya.'
                : 'Buat form pertama untuk mulai menerima jawaban.'}
            </p>
          </div>
          {!search && !status && hasPermission('form.create') && <CreateFormDialog />}
        </div>
      )}

      {!query.isLoading && !query.isError && forms.length > 0 && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Judul</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Terakhir diubah</TableHead>
                  <TableHead className="text-right">Submission</TableHead>
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {forms.map((form) => (
                  <TableRow
                    key={form.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Buka builder untuk ${form.title}`}
                    onClick={() => router.push(`/forms/${form.id}/edit`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') router.push(`/forms/${form.id}/edit`);
                    }}
                    className="focus-visible:ring-ring cursor-pointer focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{form.title}</span>
                        {form.description && (
                          <span className="text-muted-foreground max-w-md truncate text-xs">
                            {form.description}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FormStatusBadge status={form.status} />
                        {form.hasUnpublishedChanges && form.status === 'published' && (
                          <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                            Ada perubahan
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <span title={formatDateTime(form.updatedAt)}>
                        {formatRelative(form.updatedAt)}
                      </span>
                    </TableCell>

                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        <Inbox className="text-muted-foreground size-3.5" />
                        {form.submissionCount}
                      </span>
                    </TableCell>

                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/forms/${form.id}/submissions`}>
                            <Inbox />
                            Submission
                          </Link>
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/forms/${form.id}/embed`}>
                            <Code2 />
                            Embed
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-sm">
                Halaman {meta.page} dari {meta.totalPages} · {meta.total} form
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
