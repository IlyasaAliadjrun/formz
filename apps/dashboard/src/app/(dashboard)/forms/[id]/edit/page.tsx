'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { FieldType, SchemaIssue } from '@formz/shared';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Save, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { AddFieldMenu } from '@/components/builder/add-field-menu';
import { ConditionBuilder } from '@/components/builder/condition-builder';
import { FieldListPanel } from '@/components/builder/field-list-panel';
import { FormPreview } from '@/components/builder/form-preview';
import { PropertyEditor } from '@/components/builder/property-editor';
import { PublishDialog } from '@/components/builder/publish-dialog';
import { FormStatusBadge } from '@/components/forms/form-status-badge';
import { FormTabs } from '@/components/forms/form-tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useBuilderStore } from '@/lib/builder/builder-store';
import { useHasPermission } from '@/lib/hooks/use-auth';
import { useForm, usePublishForm, useSaveDraft } from '@/lib/hooks/use-forms';

export default function FormBuilderPage() {
  const params = useParams<{ id: string }>();
  const formId = params.id;

  const hasPermission = useHasPermission();
  const canEdit = hasPermission('form.edit');
  const canPublish = hasPermission('form.publish');

  const query = useForm(formId);
  const saveDraft = useSaveDraft(formId);
  const publish = usePublishForm(formId);

  const [publishOpen, setPublishOpen] = useState(false);
  const [tab, setTab] = useState<'field' | 'form'>('field');

  const schema = useBuilderStore((state) => state.schema);
  const selectedFieldId = useBuilderStore((state) => state.selectedFieldId);
  const isDirty = useBuilderStore((state) => state.isDirty);
  const loadSchema = useBuilderStore((state) => state.loadSchema);
  const markSaved = useBuilderStore((state) => state.markSaved);
  const selectField = useBuilderStore((state) => state.selectField);
  const addField = useBuilderStore((state) => state.addField);
  const updateField = useBuilderStore((state) => state.updateField);
  const removeField = useBuilderStore((state) => state.removeField);
  const duplicateField = useBuilderStore((state) => state.duplicateField);
  const moveField = useBuilderStore((state) => state.moveField);
  const setTitle = useBuilderStore((state) => state.setTitle);
  const setDescription = useBuilderStore((state) => state.setDescription);
  const updateSettings = useBuilderStore((state) => state.updateSettings);
  const getValidation = useBuilderStore((state) => state.getValidation);

  // Muat schema dari server ke store saat data tiba; jangan timpa kalau
  // pengguna sedang punya perubahan yang belum disimpan.
  useEffect(() => {
    if (query.data && !useBuilderStore.getState().isDirty) {
      loadSchema(query.data.draftSchema);
    }
  }, [query.data, loadSchema]);

  const validation = useMemo(() => (schema ? getValidation() : null), [schema, getValidation]);

  // Masalah dikelompokkan per field supaya bisa ditandai di daftar & panel properti.
  const issuesByField = useMemo(() => {
    const map = new Map<string, SchemaIssue[]>();
    if (!schema || !validation) return map;

    for (const issue of [...validation.errors, ...validation.warnings]) {
      const match = /^fields\[(\d+)\]/.exec(issue.path);
      const index = match ? Number(match[1]) : -1;
      const field = index >= 0 ? schema.fields[index] : undefined;

      if (!field) continue;

      map.set(field.id, [...(map.get(field.id) ?? []), issue]);
    }

    return map;
  }, [schema, validation]);

  const selectedField = schema?.fields.find((field) => field.id === selectedFieldId) ?? null;
  const otherFields = schema?.fields.filter((field) => field.id !== selectedFieldId) ?? [];

  const handleSaveDraft = () =>
    new Promise<boolean>((resolve) => {
      if (!schema) return resolve(false);

      saveDraft.mutate(
        { title: schema.title, schema },
        {
          onSuccess: () => {
            markSaved();
            toast.success('Draft tersimpan');
            resolve(true);
          },
          onError: (error) => {
            toast.error('Gagal menyimpan draft', { description: error.message });
            resolve(false);
          },
        },
      );
    });

  const handlePublish = async () => {
    // Publish memakai draft yang tersimpan di server, jadi perubahan lokal
    // harus disimpan lebih dulu — kalau tidak, yang terpublish bukan yang terlihat.
    if (isDirty) {
      const saved = await handleSaveDraft();
      if (!saved) return;
    }

    publish.mutate(undefined, {
      onSuccess: (form) => {
        toast.success(`Form dipublish sebagai versi ${form.publishedVersion?.versionNumber}`);
        setPublishOpen(false);
      },
    });
  };

  if (query.isLoading) {
    return (
      <div className="mx-auto grid w-full max-w-[1600px] gap-4 p-6 lg:grid-cols-[300px_1fr_340px]">
        <Skeleton className="h-[600px]" />
        <Skeleton className="h-[600px]" />
        <Skeleton className="h-[600px]" />
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
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Coba lagi
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/forms">Kembali ke daftar</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const form = query.data;

  if (!form || !schema) return null;

  return (
    <div className="flex flex-col">
      {/* ---------- Toolbar ---------- */}
      <div className="bg-background sticky top-14 z-30 border-b">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-3 px-6 py-3">
          <Button variant="ghost" size="icon" asChild aria-label="Kembali ke daftar form">
            <Link href="/forms">
              <ArrowLeft />
            </Link>
          </Button>

          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{form.title}</h1>
            <div className="flex items-center gap-2">
              <FormStatusBadge status={form.status} />
              {form.publishedVersion && (
                <span className="text-muted-foreground text-xs">
                  v{form.publishedVersion.versionNumber} terpublish
                </span>
              )}
              {isDirty && (
                <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                  Belum disimpan
                </Badge>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {validation && validation.errors.length === 0 && (
              <span className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                Schema valid
              </span>
            )}
            {validation && validation.errors.length > 0 && (
              <span className="text-destructive hidden items-center gap-1.5 text-xs sm:flex">
                <AlertCircle className="size-3.5" />
                {validation.errors.length} masalah
              </span>
            )}

            <FormTabs formId={formId} />

            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSaveDraft()}
              disabled={!canEdit || !isDirty || saveDraft.isPending}
            >
              {saveDraft.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Save Draft
            </Button>

            <Button
              size="sm"
              onClick={() => setPublishOpen(true)}
              disabled={!canPublish || publish.isPending}
              title={canPublish ? undefined : 'Butuh permission form.publish'}
            >
              <Upload />
              Publish
            </Button>
          </div>
        </div>
      </div>

      {!canEdit && (
        <div className="mx-auto w-full max-w-[1600px] px-6 pt-4">
          <Alert>
            <AlertCircle />
            <AlertTitle>Mode baca saja</AlertTitle>
            <AlertDescription>
              Akun kamu tidak punya permission <code>form.edit</code>, jadi perubahan tidak bisa
              disimpan.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* ---------- Tiga panel ---------- */}
      <div className="mx-auto grid w-full max-w-[1600px] gap-4 p-6 lg:grid-cols-[300px_1fr_360px]">
        {/* Panel kiri */}
        <aside className="flex max-h-[calc(100svh-9rem)] flex-col gap-4 overflow-y-auto rounded-lg border p-3 lg:sticky lg:top-[7.5rem]">
          <div>
            <h2 className="mb-2 text-xs font-medium tracking-wide uppercase">
              Field ({schema.fields.length})
            </h2>
            <FieldListPanel
              fields={schema.fields}
              selectedFieldId={selectedFieldId}
              issuesByField={issuesByField}
              readOnly={!canEdit}
              onSelect={selectField}
              onMove={moveField}
              onDuplicate={duplicateField}
              onRemove={removeField}
            />
          </div>

          {canEdit && (
            <>
              <Separator />
              <AddFieldMenu onAdd={(type: FieldType) => addField(type)} />
            </>
          )}
        </aside>

        {/* Panel tengah */}
        <section className="min-w-0">
          <FormPreview
            schema={schema}
            selectedFieldId={selectedFieldId}
            onSelectField={selectField}
          />
        </section>

        {/* Panel kanan */}
        <aside className="flex max-h-[calc(100svh-9rem)] flex-col overflow-y-auto rounded-lg border lg:sticky lg:top-[7.5rem]">
          <div className="flex border-b">
            <TabButton active={tab === 'field'} onClick={() => setTab('field')}>
              Properti field
            </TabButton>
            <TabButton active={tab === 'form'} onClick={() => setTab('form')}>
              Pengaturan form
            </TabButton>
          </div>

          <div className="p-4">
            {tab === 'field' &&
              (selectedField ? (
                <PropertyEditor
                  key={selectedField.id}
                  field={selectedField}
                  otherFields={otherFields}
                  issues={issuesByField.get(selectedField.id) ?? []}
                  disabled={!canEdit}
                  onChange={(patch) => updateField(selectedField.id, patch)}
                />
              ) : (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  Pilih field di panel kiri untuk mengubah propertinya.
                </p>
              ))}

            {tab === 'form' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="form-title" className="text-xs">
                    Judul form
                  </Label>
                  <Input
                    id="form-title"
                    value={schema.title}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={!canEdit}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="form-desc" className="text-xs">
                    Deskripsi
                  </Label>
                  <Textarea
                    id="form-desc"
                    rows={3}
                    value={schema.description ?? ''}
                    onChange={(event) => setDescription(event.target.value)}
                    disabled={!canEdit}
                  />
                </div>

                <Separator />

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="submit-label" className="text-xs">
                    Label tombol submit
                  </Label>
                  <Input
                    id="submit-label"
                    value={schema.settings.submitButtonLabel}
                    onChange={(event) => updateSettings({ submitButtonLabel: event.target.value })}
                    disabled={!canEdit}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="success-message" className="text-xs">
                    Pesan setelah submit
                  </Label>
                  <Textarea
                    id="success-message"
                    rows={2}
                    value={schema.settings.successMessage}
                    onChange={(event) => updateSettings({ successMessage: event.target.value })}
                    disabled={!canEdit}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="redirect-url" className="text-xs">
                    Redirect setelah submit (opsional)
                  </Label>
                  <Input
                    id="redirect-url"
                    type="url"
                    placeholder="https://example.com/terima-kasih"
                    value={schema.settings.redirectUrl ?? ''}
                    onChange={(event) =>
                      updateSettings({ redirectUrl: event.target.value || undefined })
                    }
                    disabled={!canEdit}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rate-limit" className="text-xs">
                    Batas submit per IP per jam
                  </Label>
                  <Input
                    id="rate-limit"
                    type="number"
                    min={1}
                    value={schema.settings.rateLimitPerHour}
                    onChange={(event) =>
                      updateSettings({ rateLimitPerHour: Number(event.target.value) || 60 })
                    }
                    disabled={!canEdit}
                  />
                </div>

                <Separator />

                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Kondisi tampil</h3>
                  <p className="text-muted-foreground text-[11px]">
                    Atur kondisi per field lewat tab &ldquo;Properti field&rdquo;.
                  </p>
                  {selectedField && (
                    <ConditionBuilder
                      conditions={selectedField.conditions}
                      onChange={(conditions) => updateField(selectedField.id, { conditions })}
                      availableFields={otherFields}
                      subjectLabel={`Field "${selectedField.label}"`}
                      disabled={!canEdit}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        validation={validation}
        currentVersion={form.publishedVersion?.versionNumber ?? null}
        hasUnsavedChanges={isDirty}
        isPublishing={publish.isPending || saveDraft.isPending}
        errorMessage={publish.isError ? publish.error.message : undefined}
        onConfirm={() => void handlePublish()}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'border-primary flex-1 border-b-2 px-3 py-2.5 text-xs font-medium'
          : 'text-muted-foreground hover:text-foreground flex-1 border-b-2 border-transparent px-3 py-2.5 text-xs'
      }
    >
      {children}
    </button>
  );
}
