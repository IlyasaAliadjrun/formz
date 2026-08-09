import { AlertTriangle, CheckCircle2, Clock, Minus } from 'lucide-react';
import type { IntegrationStatus } from '@/lib/api-types';
import { cn } from '@/lib/utils';

/**
 * Lencana status integrasi.
 *
 * `null` sengaja dibedakan dari `pending`: null berarti belum ada catatan sama
 * sekali (job memang belum jalan), sementara pending berarti sudah tercatat dan
 * sedang menunggu. Menyamakan keduanya membuat "belum diproses" tidak bisa
 * dibedakan dari "macet di antrean".
 */

const VARIANTS: Record<
  IntegrationStatus,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  success: {
    label: 'Berhasil',
    className:
      'text-emerald-700 bg-emerald-50 ring-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:ring-emerald-900',
    Icon: CheckCircle2,
  },
  failed: {
    label: 'Gagal',
    className: 'text-destructive bg-destructive/5 ring-destructive/25',
    Icon: AlertTriangle,
  },
  pending: {
    label: 'Menunggu',
    className:
      'text-amber-700 bg-amber-50 ring-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:ring-amber-900',
    Icon: Clock,
  },
};

export function IntegrationStatusBadge({
  status,
  label,
  className,
}: {
  status: IntegrationStatus | null;
  /** Menimpa teks bawaan, misal "Terkirim" untuk email. */
  label?: string;
  className?: string;
}) {
  if (status === null) {
    return (
      <span
        className={cn(
          'text-muted-foreground ring-border inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset',
          className,
        )}
      >
        <Minus className="size-3" />
        {label ?? 'Belum diproses'}
      </span>
    );
  }

  const variant = VARIANTS[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset',
        variant.className,
        className,
      )}
    >
      <variant.Icon className="size-3" />
      {label ?? variant.label}
    </span>
  );
}
