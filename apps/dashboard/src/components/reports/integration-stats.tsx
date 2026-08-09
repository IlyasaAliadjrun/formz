'use client';

import type { ReportIntegrationStat } from '@formz/shared';
import { cn } from '@/lib/utils';

/**
 * Status integrasi sebagai angka + progress bar.
 *
 * Bukan chart: yang perlu dijawab bagian ini cuma satu pertanyaan — "berapa
 * persen yang berhasil" — dan satu batang menjawabnya lebih langsung daripada
 * pie chart dua irisan yang menuntut pembacanya membandingkan sudut.
 *
 * Batangnya dibagi tiga warna karena tiga statusnya tidak setara: yang gagal
 * perlu ditindaklanjuti, yang menunggu tidak.
 */
export function IntegrationStats({
  stat,
  title,
  description,
  emptyLabel,
}: {
  stat: ReportIntegrationStat;
  title: string;
  description: string;
  /** Ditampilkan saat belum ada satu pun catatan. */
  emptyLabel: string;
}) {
  if (stat.total === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      </div>
    );
  }

  const segments = [
    { key: 'success', count: stat.success, className: 'bg-emerald-500', label: 'Berhasil' },
    { key: 'failed', count: stat.failed, className: 'bg-destructive', label: 'Gagal' },
    { key: 'pending', count: stat.pending, className: 'bg-amber-400', label: 'Menunggu' },
  ].filter((segment) => segment.count > 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-2xl font-semibold tabular-nums">
          {stat.successRate}
          <span className="text-muted-foreground text-base">%</span>
        </p>
      </div>

      <div
        className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`${stat.success} berhasil, ${stat.failed} gagal, ${stat.pending} menunggu dari ${stat.total} catatan`}
      >
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={cn('h-full', segment.className)}
            style={{ width: `${(segment.count / stat.total) * 100}%` }}
          />
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        {stat.success} berhasil · {stat.failed} gagal · {stat.pending} menunggu — dari {stat.total}{' '}
        catatan
      </p>
      <p className="text-muted-foreground text-xs">{description}</p>
    </div>
  );
}
