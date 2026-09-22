const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** Relative time for a unix timestamp (seconds), e.g. "5 minutes ago" / "in 2 hours". */
export function formatRelative(timestamp: number, nowMs: number, locale?: string): string {
  const diffSeconds = Math.round(timestamp - nowMs / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 45) return diffSeconds <= 0 ? 'just now' : 'in a few seconds';
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, seconds] of UNITS) {
    if (abs >= seconds) return format.format(Math.round(diffSeconds / seconds), unit);
  }
  return format.format(Math.round(diffSeconds / 60), 'minute');
}

export function formatAbsolute(timestamp: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp * 1000));
}
