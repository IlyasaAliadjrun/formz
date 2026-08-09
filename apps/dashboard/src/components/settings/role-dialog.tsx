'use client';

import { useState } from 'react';
import type { PermissionDefinition } from '@formz/shared';
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
import { Textarea } from '@/components/ui/textarea';
import type { RoleSummary } from '@/lib/api-types';
import { useSaveRole } from '@/lib/hooks/use-roles';

/**
 * Formulir role.
 *
 * Permission dikelompokkan per subject (`Form`, `Submission`, `User`, …) karena
 * itulah cara orang memikirkannya: "role ini boleh apa saja terhadap form".
 * Daftar datar sepanjang sepuluh baris memaksa pembacanya mengelompokkan sendiri.
 */

const SUBJECT_LABELS: Record<string, string> = {
  Form: 'Form',
  Submission: 'Submission',
  Report: 'Laporan',
  User: 'User & role',
  Integration: 'Integrasi & notifikasi',
  Role: 'Role',
  all: 'Lainnya',
};

export function RoleDialog({
  role,
  permissions,
  open,
  onOpenChange,
}: {
  /** Null berarti membuat role baru. */
  role: RoleSummary | null;
  permissions: PermissionDefinition[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSaveRole();

  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [permissionKeys, setPermissionKeys] = useState<string[]>(role?.permissionKeys ?? []);

  const grouped = groupBySubject(permissions);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    save.mutate(
      {
        id: role?.id,
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          permissionKeys,
        },
      },
      {
        onSuccess: () => {
          toast.success(role ? `Role "${name}" diperbarui` : `Role "${name}" dibuat`, {
            description:
              role && role.userCount > 0
                ? `Sesi ${role.userCount} user pemegang role ini dicabut — mereka perlu login ulang.`
                : undefined,
          });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{role ? 'Ubah role' : 'Buat role baru'}</DialogTitle>
            <DialogDescription>
              Centang apa saja yang boleh dilakukan pemegang role ini.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="role-name">Nama role</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Admin Cabang"
                required
                maxLength={60}
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="role-description">Keterangan</Label>
              <Textarea
                id="role-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Boleh mengelola form dan melihat submission, tanpa akses user"
                rows={2}
                maxLength={255}
              />
            </div>

            <fieldset className="flex flex-col gap-4">
              <legend className="text-sm font-medium">
                Permission ({permissionKeys.length} dipilih)
              </legend>

              {grouped.map(([subject, items]) => (
                <div key={subject} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {SUBJECT_LABELS[subject] ?? subject}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPermissionKeys((current) => toggleGroup(current, items))}
                    >
                      {items.every((item) => permissionKeys.includes(item.key))
                        ? 'Kosongkan'
                        : 'Pilih semua'}
                    </Button>
                  </div>

                  {items.map((permission) => (
                    <label key={permission.key} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        className="mt-0.5"
                        checked={permissionKeys.includes(permission.key)}
                        onCheckedChange={(checked) =>
                          setPermissionKeys((current) =>
                            checked
                              ? [...current, permission.key]
                              : current.filter((key) => key !== permission.key),
                          )
                        }
                      />
                      <span>
                        {permission.description}
                        <code className="text-muted-foreground block text-[11px]">
                          {permission.key}
                        </code>
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>

            {permissionKeys.length === 0 && (
              <Alert variant="warning">
                <AlertCircle />
                <AlertDescription>
                  <p>
                    Role tanpa permission tetap bisa disimpan, tapi pemegangnya tidak bisa membuka
                    apa pun selain halaman login.
                  </p>
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
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Mengelompokkan permission per subject, mempertahankan urutan katalog. */
function groupBySubject(
  permissions: PermissionDefinition[],
): Array<[string, PermissionDefinition[]]> {
  const groups = new Map<string, PermissionDefinition[]>();

  for (const permission of permissions) {
    const bucket = groups.get(permission.subject);

    if (bucket) bucket.push(permission);
    else groups.set(permission.subject, [permission]);
  }

  return [...groups.entries()];
}

function toggleGroup(current: string[], items: PermissionDefinition[]): string[] {
  const keys = items.map((item) => item.key);
  const allSelected = keys.every((key) => current.includes(key));

  if (allSelected) return current.filter((key) => !keys.includes(key));

  return [...new Set([...current, ...keys])];
}
