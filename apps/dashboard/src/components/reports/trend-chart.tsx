'use client';

import { useMemo } from 'react';
import type { ReportGranularity, ReportTrendPoint } from '@formz/shared';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Tren submission dari waktu ke waktu (Recharts, sesuai ARCHITECTURE.md bagian 3.1).
 *
 * Area, bukan garis: yang dibaca orang di chart ini bukan naik-turunnya
 * melainkan "seberapa banyak" — dan luas bidang menyampaikan itu lebih cepat
 * daripada garis setipis satu piksel di atas ruang kosong.
 *
 * Sumbu Y sengaja `allowDecimals={false}`: jumlah submission selalu bilangan
 * bulat, dan sumbu bertanda 0,5 pada data kecil terbaca seperti ada setengah
 * submission.
 */
export function TrendChart({
  points,
  granularity,
}: {
  points: ReportTrendPoint[];
  granularity: ReportGranularity;
}) {
  const data = useMemo(
    () => points.map((point) => ({ ...point, label: bucketLabel(point.bucket) })),
    [points],
  );

  if (points.length === 0) {
    return (
      <div className="text-muted-foreground flex h-72 items-center justify-center text-sm">
        Belum ada submission di rentang ini.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            minTickGap={16}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            cursor={{ stroke: 'var(--color-border)' }}
            // Deret ini cuma satu, jadi namanya tidak menjelaskan apa pun.
            // Tanpa separator kosong, Recharts tetap menuliskan " : " di depan
            // angkanya dan tooltipnya terbaca seperti ada label yang hilang.
            separator=""
            contentStyle={{
              background: 'var(--color-popover)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(label) =>
              granularity === 'week' ? `Minggu mulai ${String(label)}` : String(label)
            }
            formatter={(value) => [`${Number(value)} submission`, '']}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--color-primary)"
            strokeWidth={2}
            fill="url(#trend-fill)"
            // Titik hanya digambar kalau datanya sedikit; pada rentang panjang
            // lingkaran-lingkaran itu menutupi garisnya sendiri.
            dot={data.length <= 31}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const LABEL_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  // Bucket-nya memang dihitung dalam UTC di database. Tanpa ini, pembaca di
  // zona waktu barat Greenwich melihat setiap label mundur sehari.
  timeZone: 'UTC',
});

/** `2026-08-09` → `9 Agu`. Untuk mingguan, tanggal awal minggunya. */
function bucketLabel(bucket: string): string {
  const parsed = new Date(`${bucket}T00:00:00Z`);

  return Number.isNaN(parsed.getTime()) ? bucket : LABEL_FORMATTER.format(parsed);
}
