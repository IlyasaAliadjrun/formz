'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, ArrowLeft, Globe, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CopyButton } from '@/components/forms/copy-button';
import { FormStatusBadge } from '@/components/forms/form-status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useHasPermission } from '@/lib/hooks/use-auth';
import { useForm, useUpdateEmbedSettings } from '@/lib/hooks/use-forms';

const EMBED_BASE_URL = process.env.NEXT_PUBLIC_EMBED_URL ?? 'http://localhost:5173';

export default function EmbedSettingsPage() {
  const params = useParams<{ id: string }>();
  const formId = params.id;

  const hasPermission = useHasPermission();
  const canEdit = hasPermission('form.edit');

  const query = useForm(formId);
  const updateSettings = useUpdateEmbedSettings(formId);

  /**
   * `null` berarti belum diubah — nilai yang dipakai langsung dari server.
   * Menyimpannya begini menghindari useEffect untuk menyalin data server ke
   * state, yang memicu render bertingkat dan mudah menyimpang saat data refetch.
   */
  const [editedDomains, setEditedDomains] = useState<string[] | null>(null);
  const [newDomain, setNewDomain] = useState('');

  const domains = editedDomains ?? query.data?.allowedDomains ?? [];
  const dirty = editedDomains !== null;

  if (query.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat form</AlertTitle>
          <AlertDescription>
            <p>{query.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const form = query.data;
  if (!form) return null;

  const embedUrl = `${EMBED_BASE_URL}/f/${form.formKey}`;
  const iframeSnippet = `<iframe\n  src="${embedUrl}"\n  style="width:100%;border:0;min-height:600px"\n  title="${form.title.replace(/"/g, '&quot;')}"\n  loading="lazy"\n></iframe>`;
  const scriptSnippet = `<script src="${EMBED_BASE_URL}/embed.js" data-form="${form.formKey}" async></script>`;

  const addDomain = () => {
    const value = newDomain.trim();
    if (!value) return;

    if (domains.includes(value)) {
      toast.error('Domain sudah ada di daftar');
      return;
    }

    setEditedDomains([...domains, value]);
    setNewDomain('');
  };

  const removeDomain = (domain: string) => {
    setEditedDomains(domains.filter((item) => item !== domain));
  };

  const save = () =>
    updateSettings.mutate(
      { allowedDomains: domains },
      {
        onSuccess: () => {
          // Kembali mengikuti data server: server menormalkan domain (membuang
          // skema/path dan menurunkan ke huruf kecil), jadi yang benar adalah
          // hasil dari server, bukan yang diketik.
          setEditedDomains(null);
          toast.success('Whitelist domain disimpan');
        },
        onError: (error) => toast.error('Gagal menyimpan', { description: error.message }),
      },
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Kembali ke builder">
          <Link href={`/forms/${formId}/edit`}>
            <ArrowLeft />
          </Link>
        </Button>

        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pengaturan Embed</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-muted-foreground text-sm">{form.title}</span>
            <FormStatusBadge status={form.status} />
          </div>
        </div>
      </header>

      {form.status !== 'published' && (
        <Alert variant="warning">
          <AlertCircle />
          <AlertTitle>Form belum dipublish</AlertTitle>
          <AlertDescription>
            Snippet di bawah sudah bisa disalin, tapi form baru bisa diisi setelah dipublish dari
            halaman builder.
          </AlertDescription>
        </Alert>
      )}

      {/* ---------- Form key ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Form key</CardTitle>
          <CardDescription>
            Token publik untuk form ini. Sengaja acak, bukan id database, supaya form lain tidak
            bisa ditebak dengan mengubah URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <code className="bg-muted flex-1 truncate rounded-md px-3 py-2 font-mono text-sm">
              {form.formKey}
            </code>
            <CopyButton value={form.formKey} />
          </div>

          <div className="flex items-center gap-2">
            <code className="bg-muted flex-1 truncate rounded-md px-3 py-2 font-mono text-xs">
              {embedUrl}
            </code>
            <CopyButton value={embedUrl} label="Salin URL" />
          </div>
        </CardContent>
      </Card>

      {/* ---------- Snippet ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pasang di website</CardTitle>
          <CardDescription>
            iframe adalah cara yang disarankan — form terisolasi dari CSS dan JavaScript website
            yang memasangnya.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <SnippetBlock
            title="iframe (disarankan)"
            description="Paling aman dan terisolasi."
            snippet={iframeSnippet}
          />
          <SnippetBlock
            title="Script tag"
            description="Satu baris — iframe dibuat otomatis di posisi snippet ini, lengkap dengan penyesuaian tinggi."
            snippet={scriptSnippet}
          />
        </CardContent>
      </Card>

      {/* ---------- Whitelist domain ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Domain yang diizinkan</CardTitle>
          <CardDescription>
            Batasi website mana saja yang boleh memasang form ini. Kosongkan daftar untuk
            mengizinkan semua domain.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-domain" className="text-xs">
                Tambah domain
              </Label>
              <Input
                id="new-domain"
                value={newDomain}
                onChange={(event) => setNewDomain(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addDomain();
                  }
                }}
                placeholder="example.com atau *.example.com"
                disabled={!canEdit}
              />
            </div>
            <Button variant="outline" onClick={addDomain} disabled={!canEdit || !newDomain.trim()}>
              <Plus />
              Tambah
            </Button>
          </div>

          {domains.length === 0 ? (
            <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm">
              <Globe className="size-4" />
              Semua domain diizinkan memasang form ini.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {domains.map((domain) => (
                <li
                  key={domain}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="truncate font-mono text-sm">{domain}</span>
                  <button
                    type="button"
                    onClick={() => removeDomain(domain)}
                    disabled={!canEdit}
                    className="text-muted-foreground hover:text-destructive shrink-0 rounded p-1"
                    aria-label={`Hapus ${domain}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              Skema dan path otomatis dibuang saat disimpan — <code>https://a.com/x</code> menjadi{' '}
              <code>a.com</code>.
            </p>
            <Button onClick={save} disabled={!canEdit || !dirty || updateSettings.isPending}>
              {updateSettings.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Simpan
            </Button>
          </div>

          {updateSettings.isError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{updateSettings.error.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SnippetBlock({
  title,
  description,
  snippet,
}: {
  title: string;
  description: string;
  snippet: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        <CopyButton value={snippet} />
      </div>
      <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
        <code>{snippet}</code>
      </pre>
    </div>
  );
}
