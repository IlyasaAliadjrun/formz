'use client';

import { useState } from 'react';
import {
  SHEET_META_COLUMNS,
  getInputFields,
  googleSheetConfigSchema,
  type FormSchema,
  type SheetMetaColumnKey,
} from '@formz/shared';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { Switch } from '@/components/ui/switch';
import type { SheetIntegration } from '@/lib/api-types';
import { useSaveSheetIntegration } from '@/lib/hooks/use-integrations';

/**
 * Formulir target spreadsheet.
 *
 * Pemilihan kolom disajikan sebagai daftar centang berurut mengikuti urutan
 * field di form, bukan sebagai pemetaan "field → huruf kolom". Pemetaan huruf
 * mudah rusak begitu satu kolom disisipkan di spreadsheet, sementara urutan
 * ditulis-berurutan cocok dengan cara `values.append` bekerja.
 */
export function SheetIntegrationDialog({
  formId,
  schema,
  integration,
  open,
  onOpenChange,
}: {
  formId: string;
  schema: FormSchema | null;
  /** Null berarti membuat integrasi baru. */
  integration: SheetIntegration | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSaveSheetIntegration(formId);
  const fields = schema ? getInputFields(schema) : [];

  const [spreadsheetId, setSpreadsheetId] = useState(integration?.config.spreadsheetId ?? '');
  const [sheetName, setSheetName] = useState(integration?.config.sheetName ?? 'Sheet1');
  const [metaColumns, setMetaColumns] = useState<SheetMetaColumnKey[]>(
    integration?.config.metaColumns ?? ['submittedAt'],
  );
  const [fieldIds, setFieldIds] = useState<string[]>(integration?.config.fieldIds ?? []);
  const [writeHeader, setWriteHeader] = useState(integration?.config.writeHeader ?? true);
  const [isActive, setIsActive] = useState(integration?.isActive ?? true);

  const allFields = fieldIds.length === 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const config = googleSheetConfigSchema.parse({
      spreadsheetId: spreadsheetId.trim(),
      sheetName: sheetName.trim(),
      metaColumns,
      fieldIds,
      writeHeader,
      credentialRef: integration?.config.credentialRef ?? 'default',
    });

    save.mutate(
      { integrationId: integration?.id, body: { config, isActive } },
      {
        onSuccess: () => {
          toast.success(integration ? 'Integrasi diperbarui' : 'Integrasi ditambahkan');
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {integration ? 'Ubah target spreadsheet' : 'Tambah target spreadsheet'}
            </DialogTitle>
            <DialogDescription>
              Setiap submission ditulis sebagai satu baris baru di tab yang dipilih.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sheet-id">URL atau ID spreadsheet</Label>
              <Input
                id="sheet-id"
                value={spreadsheetId}
                onChange={(event) => setSpreadsheetId(event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                required
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                Tempelkan URL-nya apa adanya; bagian ID-nya diambil otomatis.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sheet-name">Nama tab</Label>
              <Input
                id="sheet-name"
                value={sheetName}
                onChange={(event) => setSheetName(event.target.value)}
                placeholder="Sheet1"
                required
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                Tab-nya harus sudah ada di spreadsheet. Formz tidak membuat tab baru.
              </p>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Kolom metadata</legend>
              {SHEET_META_COLUMNS.map((column) => (
                <label key={column.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={metaColumns.includes(column.key)}
                    onCheckedChange={(checked) =>
                      setMetaColumns((current) =>
                        checked
                          ? [
                              ...SHEET_META_COLUMNS.map((item) => item.key).filter(
                                (key) => key === column.key || current.includes(key),
                              ),
                            ]
                          : current.filter((key) => key !== column.key),
                      )
                    }
                  />
                  {column.label}
                </label>
              ))}
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Kolom jawaban</legend>
              <p className="text-muted-foreground mb-1 text-xs">
                {allFields
                  ? 'Semua field ikut ditulis, mengikuti urutan di form. Centang sebagian kalau ingin memilih sendiri.'
                  : `${fieldIds.length} field dipilih. Urutan kolom mengikuti urutan field di form.`}
              </p>

              {fields.length === 0 && (
                <p className="text-muted-foreground text-sm">Form ini belum punya field jawaban.</p>
              )}

              {fields.map((field) => (
                <label key={field.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={allFields || fieldIds.includes(field.id)}
                    onCheckedChange={(checked) =>
                      setFieldIds((current) => {
                        // Saat masih "semua field", mencentang-lepas satu field
                        // berarti berpindah ke daftar eksplisit berisi sisanya.
                        const base = current.length === 0 ? fields.map((item) => item.id) : current;

                        return checked
                          ? fields
                              .map((item) => item.id)
                              .filter((id) => id === field.id || base.includes(id))
                          : base.filter((id) => id !== field.id);
                      })
                    }
                  />
                  {field.label}
                </label>
              ))}
            </fieldset>

            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                Tulis baris header
                <span className="text-muted-foreground block text-xs">
                  Hanya kalau tab-nya masih benar-benar kosong.
                </span>
              </span>
              <Switch checked={writeHeader} onCheckedChange={setWriteHeader} />
            </label>

            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                Aktif
                <span className="text-muted-foreground block text-xs">
                  Kalau dimatikan, submission baru tidak lagi disinkronkan ke sini.
                </span>
              </span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </label>

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
            <Button type="submit" disabled={save.isPending || !spreadsheetId.trim()}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
