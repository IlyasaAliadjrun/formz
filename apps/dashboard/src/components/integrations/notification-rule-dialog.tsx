'use client';

import { useState } from 'react';
import {
  DEFAULT_EMAIL_SUBJECT,
  EMAIL_TEMPLATES,
  getInputFields,
  type ConditionGroup,
  type EmailTemplateId,
  type FormSchema,
  type RecipientRule,
  type RecipientRules,
} from '@formz/shared';
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConditionBuilder } from '@/components/builder/condition-builder';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { NotificationRule } from '@/lib/api-types';
import { useSaveNotificationRule } from '@/lib/hooks/use-integrations';

/**
 * Formulir aturan notifikasi.
 *
 * Kondisi "kapan dikirim" dan kondisi penerima bersyarat memakai
 * `ConditionBuilder` yang sama dengan form builder. Komponen itu memang
 * terkendali penuh lewat props, jadi bisa dipakai ulang apa adanya — dan
 * artinya operator serta cara memilih nilai opsi persis sama dengan yang sudah
 * dikenal orang dari builder.
 */
export function NotificationRuleDialog({
  formId,
  schema,
  rule,
  open,
  onOpenChange,
}: {
  formId: string;
  schema: FormSchema | null;
  rule: NotificationRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSaveNotificationRule(formId);
  const fields = schema ? getInputFields(schema) : [];
  const emailFields = fields.filter((field) => field.type === 'email');

  const [name, setName] = useState(rule?.name ?? '');
  const [subject, setSubject] = useState(rule?.subject ?? DEFAULT_EMAIL_SUBJECT);
  const [templateId, setTemplateId] = useState<EmailTemplateId>(
    rule?.emailTemplateId ?? EMAIL_TEMPLATES[0].id,
  );
  const [recipientsText, setRecipientsText] = useState((rule?.recipients ?? []).join('\n'));
  const [recipientFieldIds, setRecipientFieldIds] = useState<string[]>(
    rule?.recipientFieldIds ?? [],
  );
  const [condition, setCondition] = useState<ConditionGroup | null>(rule?.condition ?? null);
  const [recipientRules, setRecipientRules] = useState<RecipientRule[]>(
    rule?.recipientRules?.rules ?? [],
  );
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);

  const recipients = parseEmails(recipientsText);
  const hasRecipients =
    recipients.length > 0 || recipientFieldIds.length > 0 || recipientRules.length > 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const rules: RecipientRules | null =
      recipientRules.length > 0 ? { rules: recipientRules } : null;

    save.mutate(
      {
        ruleId: rule?.id,
        body: {
          name: name.trim() || null,
          subject: subject.trim(),
          emailTemplateId: templateId,
          condition,
          recipients,
          recipientFieldIds,
          recipientRules: rules,
          isActive,
        },
      },
      {
        onSuccess: () => {
          toast.success(rule ? 'Aturan notifikasi diperbarui' : 'Aturan notifikasi ditambahkan');
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {rule ? 'Ubah aturan notifikasi' : 'Tambah aturan notifikasi'}
            </DialogTitle>
            <DialogDescription>
              Email dikirim otomatis setiap ada submission baru yang cocok dengan aturan ini.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-name">Nama aturan</Label>
                <Input
                  id="rule-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Tim panitia"
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-template">Template</Label>
                <NativeSelect
                  id="rule-template"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value as EmailTemplateId)}
                >
                  {EMAIL_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-muted-foreground text-xs">
                  {EMAIL_TEMPLATES.find((template) => template.id === templateId)?.description}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-subject">Subjek email</Label>
              <Input
                id="rule-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                required
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                Token yang tersedia: <code>{'{{form}}'}</code>, <code>{'{{date}}'}</code>,{' '}
                <code>{'{{submissionId}}'}</code>, dan nama field —{' '}
                {fields.length > 0 ? (
                  <code>{`{{${fields[0]?.name}}}`}</code>
                ) : (
                  <span>misalnya nama_lengkap</span>
                )}
                .
              </p>
            </div>

            <Separator />

            {/* ---------- Penerima ---------- */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-recipients">Email tujuan tetap</Label>
              <Textarea
                id="rule-recipients"
                value={recipientsText}
                onChange={(event) => setRecipientsText(event.target.value)}
                placeholder={'panitia@example.com\nmanajer@example.com'}
                rows={3}
              />
              <p className="text-muted-foreground text-xs">Satu alamat per baris.</p>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Kirim juga ke pengisi form</legend>
              <p className="text-muted-foreground mb-1 text-xs">
                Jawaban field email di bawah ikut dijadikan tujuan — inilah cara membuat balasan
                otomatis ke orang yang mengisi form.
              </p>

              {emailFields.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Form ini belum punya field bertipe email.
                </p>
              ) : (
                emailFields.map((field) => (
                  <label key={field.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={recipientFieldIds.includes(field.id)}
                      onCheckedChange={(checked) =>
                        setRecipientFieldIds((current) =>
                          checked
                            ? [...current, field.id]
                            : current.filter((id) => id !== field.id),
                        )
                      }
                    />
                    {field.label}
                  </label>
                ))
              )}
            </fieldset>

            {/* ---------- Penerima bersyarat ---------- */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Penerima bersyarat</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRecipientRules((current) => [
                      ...current,
                      {
                        condition: { action: 'show', logic: 'AND', rules: [] },
                        recipients: [],
                      },
                    ])
                  }
                >
                  <Plus />
                  Tambah
                </Button>
              </div>

              {recipientRules.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Belum ada. Berguna misalnya untuk meneruskan ke tim tertentu hanya kalau
                  jawabannya memilih layanan tertentu.
                </p>
              )}

              {recipientRules.map((item, index) => (
                <div key={index} className="flex flex-col gap-3 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground text-xs">Aturan {index + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus aturan penerima ${index + 1}`}
                      onClick={() =>
                        setRecipientRules((current) =>
                          current.filter((_, position) => position !== index),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  <ConditionBuilder
                    conditions={{ visibility: item.condition }}
                    onChange={(conditions) =>
                      setRecipientRules((current) =>
                        current.map((rule, position) =>
                          position === index
                            ? {
                                ...rule,
                                condition: conditions?.visibility ?? {
                                  action: 'show',
                                  logic: 'AND',
                                  rules: [],
                                },
                              }
                            : rule,
                        ),
                      )
                    }
                    availableFields={fields}
                    subjectLabel="penerima ini"
                    actionLabels={{ show: 'Tambahkan', hide: 'Jangan tambahkan' }}
                    emptyLabel="Penerima ini selalu ikut ditambahkan."
                  />

                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`recipient-rule-${index}`}>Email tujuan</Label>
                    <Textarea
                      id={`recipient-rule-${index}`}
                      value={item.recipients.join('\n')}
                      onChange={(event) =>
                        setRecipientRules((current) =>
                          current.map((rule, position) =>
                            position === index
                              ? { ...rule, recipients: parseEmails(event.target.value) }
                              : rule,
                          ),
                        )
                      }
                      rows={2}
                      placeholder="sales@example.com"
                    />
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            {/* ---------- Kapan dikirim ---------- */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Kapan aturan ini dipakai</span>
              <ConditionBuilder
                conditions={condition ? { visibility: condition } : undefined}
                onChange={(conditions) => setCondition(conditions?.visibility ?? null)}
                availableFields={fields}
                subjectLabel="email ini"
                actionLabels={{ show: 'Kirim', hide: 'Jangan kirim' }}
                emptyLabel="Tanpa kondisi, email dikirim untuk setiap submission."
              />
            </div>

            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Aktif</span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </label>

            {!hasRecipients && (
              <Alert variant="warning">
                <AlertCircle />
                <AlertDescription>
                  Aturan ini belum punya penerima. Isi minimal salah satu bagian penerima di atas.
                </AlertDescription>
              </Alert>
            )}

            {save.isError && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{save.error.message}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={save.isPending || !hasRecipients}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Menerima daftar dipisah baris baru maupun koma, karena orang menempel keduanya. */
function parseEmails(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\n,;]/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}
