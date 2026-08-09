'use client';

import { useState } from 'react';
import { AlertCircle, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { UserDialog } from '@/components/settings/user-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { UserSummary } from '@/lib/api-types';
import { formatDateTime } from '@/lib/format';
import { useCurrentUser } from '@/lib/hooks/use-auth';
import { useRoleList } from '@/lib/hooks/use-roles';
import { useDeleteUser, useUserList } from '@/lib/hooks/use-users';

const PER_PAGE = 25;

export default function UsersSettingsPage() {
  const { data: currentUser } = useCurrentUser();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; value: UserSummary | null }>({
    open: false,
    value: null,
  });

  const users = useUserList({ page, perPage: PER_PAGE, search: search || undefined });
  const roles = useRoleList();
  const remove = useDeleteUser();

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const handleDelete = (user: UserSummary) => {
    if (
      !confirm(`Hapus user "${user.name}" (${user.email})? Tindakan ini tidak bisa dibatalkan.`)
    ) {
      return;
    }

    remove.mutate(user.id, {
      onSuccess: () => toast.success(`User "${user.name}" dihapus`),
      // Penolakan dari server di sini bukan error teknis melainkan pengaman —
      // menghapus Super Admin terakhir atau akun sendiri. Pesannya sudah jelas.
      onError: (error) => toast.error(error.message, { duration: 10_000 }),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Cari nama atau email"
              className="w-64 pl-8"
              aria-label="Cari user"
            />
          </div>
          <Button type="submit" variant="outline">
            Cari
          </Button>
          {search && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setPage(1);
              }}
            >
              Hapus filter
            </Button>
          )}
        </form>

        <Button onClick={() => setDialog({ open: true, value: null })}>
          <Plus />
          Tambah user
        </Button>
      </div>

      {users.isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat daftar user</AlertTitle>
          <AlertDescription>
            <p>{users.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void users.refetch()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {users.isLoading ? (
            <div className="flex flex-col gap-2 p-6">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : users.data?.data.length === 0 ? (
            <p className="text-muted-foreground p-10 text-center text-sm">
              {search ? `Tidak ada user yang cocok dengan "${search}".` : 'Belum ada user.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead className="w-24 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {users.data?.data.map((user) => {
                  const isSelf = user.id === currentUser?.id;

                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.name}
                        {isSelf && (
                          <Badge variant="secondary" className="ml-2">
                            Kamu
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{user.email}</TableCell>
                      <TableCell>
                        {user.roles.length === 0 ? (
                          <span className="text-muted-foreground text-xs">Tanpa role</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {user.roles.map((role) => (
                              <Badge key={role.id} variant="outline">
                                {role.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.isActive ? (
                          <Badge variant="secondary">Aktif</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Nonaktif
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatDateTime(user.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Ubah ${user.name}`}
                            onClick={() => setDialog({ open: true, value: user })}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Hapus ${user.name}`}
                            // Menghapus akun sendiri selalu ditolak server; tombolnya
                            // dimatikan supaya penolakan itu tidak perlu terjadi.
                            disabled={isSelf || remove.isPending}
                            title={isSelf ? 'Tidak bisa menghapus akun sendiri' : undefined}
                            onClick={() => handleDelete(user)}
                          >
                            {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {users.data && users.data.meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Halaman {users.data.meta.page} dari {users.data.meta.totalPages} ·{' '}
            {users.data.meta.total} user
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= users.data.meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}

      {dialog.open && (
        <UserDialog
          // key memaksa state formulir dibuat ulang saat berpindah antar user.
          key={dialog.value?.id ?? 'baru'}
          user={dialog.value}
          roles={roles.data?.data ?? []}
          isSelf={dialog.value?.id === currentUser?.id}
          open
          onOpenChange={(open) => setDialog({ open, value: open ? dialog.value : null })}
        />
      )}
    </div>
  );
}
