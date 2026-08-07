const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

export function formatDateTime(value: string | Date): string {
  return DATE_TIME_FORMATTER.format(new Date(value));
}

/** "3 hari lalu". Dipakai di kolom tanggal update supaya cepat dibaca. */
export function formatRelative(value: string | Date): string {
  const diff = new Date(value).getTime() - Date.now();
  const absolute = Math.abs(diff);

  for (const [unit, ms] of UNITS) {
    if (absolute >= ms) return RELATIVE_FORMATTER.format(Math.round(diff / ms), unit);
  }

  return 'baru saja';
}
