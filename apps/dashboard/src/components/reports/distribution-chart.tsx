'use client';

import type { ReportFieldDistribution } from '@formz/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Distribusi jawaban satu field: berapa persen memilih tiap opsi.
 *
 * Batang **horizontal**, bukan vertikal. Label opsi di form nyata sering
 * panjang ("Saya bersedia dihubungi lewat WhatsApp"); pada batang vertikal
 * label seperti itu harus dimiringkan atau dipotong, dan chart-nya jadi tidak
 * terbaca justru pada form yang paling butuh dibaca.
 *
 * Warna batang seragam dan sengaja tidak berputar per opsi: opsi di sini bukan
 * kategori yang perlu dibedakan warnanya — sudah ada labelnya sendiri di sumbu
 * kiri — dan warna-warni hanya menyarankan makna yang tidak ada.
 */
export function DistributionChart({ distribution }: { distribution: ReportFieldDistribution }) {
  const data = distribution.options.map((option) => ({
    ...option,
    name: option.orphan ? `${option.label} (dihapus)` : option.label,
  }));

  if (distribution.respondents === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Belum ada yang menjawab field ini di rentang tersebut.
      </p>
    );
  }

  // Tinggi mengikuti jumlah opsi: chart setinggi tetap membuat form dengan dua
  // opsi punya batang setebal balok, dan form dengan dua belas opsi berdesakan.
  const height = Math.max(140, data.length * 38 + 32);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={160}
            tick={{ fontSize: 12, fill: 'var(--color-foreground)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-accent)' }}
            // Lihat catatan separator di trend-chart.tsx.
            separator=""
            contentStyle={{
              background: 'var(--color-popover)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, _name, item) => [
              `${Number(value)} jawaban · ${(item.payload as { percentage: number }).percentage}%`,
              '',
            ]}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={22}>
            {data.map((option) => (
              <Cell
                key={option.optionId}
                fill={option.orphan ? 'var(--color-muted-foreground)' : 'var(--color-primary)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
