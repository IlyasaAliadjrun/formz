'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateForm } from '@/lib/hooks/use-forms';

export function CreateFormDialog({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const createForm = useCreateForm();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    createForm.mutate(
      { title: title.trim(), description: description.trim() || undefined },
      {
        onSuccess: (form) => {
          toast.success(`Form "${form.title}" dibuat`);
          setOpen(false);
          setTitle('');
          setDescription('');
          // Langsung masuk ke builder — form baru selalu kosong dan perlu diisi.
          router.push(`/forms/${form.id}/edit`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Plus />
          Buat Form
        </Button>
      </DialogTrigger>

      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Buat form baru</DialogTitle>
            <DialogDescription>
              Form dibuat sebagai draft. Kamu bisa menyusun field-nya setelah ini.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="form-title">Judul form</Label>
              <Input
                id="form-title"
                required
                maxLength={255}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Misal: Pendaftaran Layanan"
                disabled={createForm.isPending}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="form-description">Deskripsi (opsional)</Label>
              <Textarea
                id="form-description"
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={createForm.isPending}
              />
            </div>

            {createForm.isError && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{createForm.error.message}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createForm.isPending}
            >
              Batal
            </Button>
            <Button type="submit" disabled={createForm.isPending || !title.trim()}>
              {createForm.isPending && <Loader2 className="animate-spin" />}
              Buat & susun field
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
