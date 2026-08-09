'use client';

import { useState } from 'react';
import { AlertCircle, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { RoleDialog } from '@/components/settings/role-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { RoleSummary } from '@/lib/api-types';
import { useDeleteRole, usePermissionCatalog, useRoleList } from '@/lib/hooks/use-roles';

export default function RolesSettingsPage() {
  const roles = useRoleList();
  const catalog = usePermissionCatalog();
  const remove = useDeleteRole();

  const [dialog, setDialog] = useState<{ open: boolean; value: RoleSummary | null }>({
    open: false,
    value: null,
  });

  const handleDelete = (role: RoleSummary) => {
    if (!confirm(`Hapus role "${role.name}"?`)) return;

    remove.mutate(role.id, {
      onSuccess: () => toast.success(`Role "${role.name}" dihapus`),
      onError: (error) => toast.error(error.message, { duration: 10_000 }),
    });
  };

  if (roles.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Gagal memuat daftar role</AlertTitle>
        <AlertDescription>
          <p>{roles.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void roles.refetch()}>
            Coba lagi
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Role menentukan apa yang boleh dilakukan pemegangnya. Role bawaan sistem tidak bisa diubah
          karena permission-nya disetel ulang dari kode setiap seed dijalankan — buat role baru
          kalau butuh kombinasi lain.
        </p>

        <Button onClick={() => setDialog({ open: true, value: null })}>
          <Plus />
          Buat role
        </Button>
      </div>

      {roles.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {roles.data?.data.map((role) => (
            <Card key={role.id}>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{role.name}</span>
                      {role.isSystem && (
                        <Badge variant="outline" className="gap-1">
                          <Lock className="size-3" />
                          Bawaan sistem
                        </Badge>
                      )}
                      <span className="text-muted-foreground text-xs">
                        {role.userCount === 0
                          ? 'Belum dipakai user'
                          : `Dipakai ${role.userCount} user`}
                      </span>
                    </div>
                    {role.description && (
                      <p className="text-muted-foreground mt-1 text-sm">{role.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Ubah ${role.name}`}
                      disabled={role.isSystem}
                      title={role.isSystem ? 'Role bawaan tidak bisa diubah' : undefined}
                      onClick={() => setDialog({ open: true, value: role })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus ${role.name}`}
                      disabled={role.isSystem || role.userCount > 0 || remove.isPending}
                      title={
                        role.isSystem
                          ? 'Role bawaan tidak bisa dihapus'
                          : role.userCount > 0
                            ? 'Masih dipakai user — pindahkan mereka ke role lain dulu'
                            : undefined
                      }
                      onClick={() => handleDelete(role)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                {role.permissionKeys.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Tanpa permission — pemegangnya tidak bisa membuka apa pun.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {role.permissionKeys.map((key) => (
                      <Badge key={key} variant="secondary" className="font-mono text-[11px]">
                        {key}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dialog.open && (
        <RoleDialog
          key={dialog.value?.id ?? 'baru'}
          role={dialog.value}
          permissions={catalog.data?.data ?? []}
          open
          onOpenChange={(open) => setDialog({ open, value: open ? dialog.value : null })}
        />
      )}
    </div>
  );
}
