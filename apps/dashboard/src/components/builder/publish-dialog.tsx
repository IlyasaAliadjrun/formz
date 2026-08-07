'use client';

import type { SchemaValidationResult } from '@formz/shared';
import { AlertCircle, AlertTriangle, Loader2, Upload } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  validation: SchemaValidationResult | null;
  /** Nomor versi yang sudah terpublish, null kalau belum pernah. */
  currentVersion: number | null;
  hasUnsavedChanges: boolean;
  isPublishing: boolean;
  errorMessage?: string;
  onConfirm: () => void;
}

/**
 * Konfirmasi publish.
 *
 * Publish membuat versi schema baru yang permanen dan langsung dipakai form
 * publik, jadi dikonfirmasi eksplisit — termasuk menampilkan masalah schema yang
 * akan membuat server menolak, supaya kegagalan tidak baru ketahuan setelah klik.
 */
export function PublishDialog({
  open,
  onOpenChange,
  validation,
  currentVersion,
  hasUnsavedChanges,
  isPublishing,
  errorMessage,
  onConfirm,
}: PublishDialogProps) {
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const blocked = errors.length > 0;
  const nextVersion = (currentVersion ?? 0) + 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish form ini?</DialogTitle>
          <DialogDescription>
            {currentVersion
              ? `Versi ${nextVersion} akan dibuat. Versi ${currentVersion} tetap tersimpan dan submission lama tidak berubah.`
              : 'Versi 1 akan dibuat dan form langsung bisa diisi lewat URL publiknya.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {hasUnsavedChanges && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Ada perubahan yang belum disimpan</AlertTitle>
              <AlertDescription>
                Perubahan akan ikut disimpan sebagai draft sebelum dipublish.
              </AlertDescription>
            </Alert>
          )}

          {blocked && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>
                {errors.length} masalah harus diperbaiki sebelum bisa dipublish
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {errors.slice(0, 6).map((issue, index) => (
                    <li key={index}>{issue.message}</li>
                  ))}
                  {errors.length > 6 && <li>dan {errors.length - 6} lainnya</li>}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {!blocked && warnings.length > 0 && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>{warnings.length} peringatan</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {warnings.slice(0, 4).map((issue, index) => (
                    <li key={index}>{issue.message}</li>
                  ))}
                </ul>
                <p className="mt-1">Publish tetap bisa dilanjutkan.</p>
              </AlertDescription>
            </Alert>
          )}

          {errorMessage && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Publish gagal</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPublishing}>
            Batal
          </Button>
          <Button onClick={onConfirm} disabled={blocked || isPublishing}>
            {isPublishing ? <Loader2 className="animate-spin" /> : <Upload />}
            {isPublishing ? 'Mempublish...' : `Publish versi ${nextVersion}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
