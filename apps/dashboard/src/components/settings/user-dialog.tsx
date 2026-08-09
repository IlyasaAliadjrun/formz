'use client';

import { useState } from 'react';
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
import type { RoleSummary, UserSummary } from '@/lib/api-types';
import { useCreateUser, useUpdateUser, type UpdateUserInput } from '@/lib/hooks/use-users';

/** Sama dengan `passwordField` di apps/api — dibuat sama supaya ditolak sebelum dikirim. */
const MIN_PASSWORD_LENGTH = 12;

export function UserDialog({
  user,
  roles,
  /** True kalau user yang sedang login adalah user ini — beberapa aksi dikunci. */
  isSelf,
  open,
  onOpenChange,
}: {
  user: UserSummary | null;
  roles: RoleSummary[];
  isSelf: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateUser();
  const update = useUpdateUser();
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>(user?.roles.map((role) => role.id) ?? []);
  const [isActive, setIsActive] = useState(user?.isActive ?? true);

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const passwordRequired = !user;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (user) {
      // Hanya kirim yang benar-benar berubah: API memperlakukan field yang absen
      // sebagai "jangan ubah", dan mengirim password kosong akan menolak validasi.
      const body: UpdateUserInput = {};

      if (email.trim().toLowerCase() !== user.email) body.email = email.trim();
      if (name.trim() !== user.name) body.name = name.trim();
      if (password) body.password = password;
      if (
        !sameMembers(
          roleIds,
          user.roles.map((role) => role.id),
        )
      )
        body.roleIds = roleIds;
      if (isActive !== user.isActive) body.isActive = isActive;

      if (Object.keys(body).length === 0) {
        onOpenChange(false);

        return;
      }

      update.mutate(
        { id: user.id, body },
        {
          onSuccess: () => {
            toast.success(`User "${name}" diperbarui`, {
              description:
                body.roleIds || body.password || body.isActive === false
                  ? 'Sesi user ini dicabut karena hak aksesnya berubah — dia perlu login ulang.'
                  : undefined,
            });
            onOpenChange(false);
          },
        },
      );

      return;
    }

    create.mutate(
      { email: email.trim(), name: name.trim(), password, roleIds, isActive },
      {
        onSuccess: () => {
          toast.success(`User "${name}" dibuat`);
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
            <DialogTitle>{user ? 'Ubah user' : 'Tambah user'}</DialogTitle>
            <DialogDescription>
              {user
                ? 'Kosongkan password kalau tidak ingin menggantinya.'
                : 'User baru langsung bisa login dengan email dan password ini.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="user-name">Nama</Label>
              <Input
                id="user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="user-password">
                Password {user && <span className="text-muted-foreground">(opsional)</span>}
              </Label>
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required={passwordRequired}
                minLength={passwordRequired ? MIN_PASSWORD_LENGTH : undefined}
                autoComplete="new-password"
                aria-describedby="user-password-hint"
              />
              <p
                id="user-password-hint"
                className={
                  passwordTooShort ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'
                }
              >
                Minimal {MIN_PASSWORD_LENGTH} karakter.
                {user && ' Mengganti password akan mencabut seluruh sesi user ini.'}
              </p>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Role</legend>
              {roles.length === 0 && (
                <p className="text-muted-foreground text-sm">Belum ada role yang bisa dipilih.</p>
              )}
              {roles.map((role) => (
                <label key={role.id} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={roleIds.includes(role.id)}
                    onCheckedChange={(checked) =>
                      setRoleIds((current) =>
                        checked ? [...current, role.id] : current.filter((id) => id !== role.id),
                      )
                    }
                  />
                  <span>
                    {role.name}
                    <span className="text-muted-foreground block text-xs">
                      {role.description ?? `${role.permissionKeys.length} permission`}
                    </span>
                  </span>
                </label>
              ))}
              <p className="text-muted-foreground text-xs">
                User tanpa role tetap bisa login, tapi tidak bisa membuka apa pun.
              </p>
            </fieldset>

            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                Aktif
                <span className="text-muted-foreground block text-xs">
                  User nonaktif ditolak saat login, dan seluruh sesinya dicabut.
                </span>
              </span>
              <Switch checked={isActive} onCheckedChange={setIsActive} disabled={isSelf} />
            </label>

            {isSelf && (
              <p className="text-muted-foreground text-xs">
                Ini akun kamu sendiri, jadi status aktifnya dikunci di sini.
              </p>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={pending || passwordTooShort}>
              {pending && <Loader2 className="animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Perbandingan tanpa memandang urutan — urutan centang tidak berarti apa-apa. */
function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;

  const set = new Set(b);

  return a.every((item) => set.has(item));
}
