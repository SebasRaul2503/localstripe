/** Currencies without minor units (Stripe's zero-decimal list). */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

export function formatAmount(amount: number, currency: string): string {
  const decimals = ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase()) ? 0 : 2;
  const value = (amount / 10 ** decimals).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${value} ${currency.toUpperCase()}`;
}

export function formatDate(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined) return '-';
  return new Date(unixSeconds * 1000).toISOString().replace('.000Z', 'Z');
}

export interface Colors {
  green: (text: string) => string;
  red: (text: string) => string;
  yellow: (text: string) => string;
  dim: (text: string) => string;
  bold: (text: string) => string;
}

const wrap = (open: number, close: number) => (text: string) =>
  `\u001b[${open}m${text}\u001b[${close}m`;

export function createColors(enabled: boolean): Colors {
  if (!enabled) {
    const identity = (text: string) => text;
    return { green: identity, red: identity, yellow: identity, dim: identity, bold: identity };
  }
  return {
    green: wrap(32, 39),
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}

export function shouldUseColor(env: Record<string, string | undefined>, isTTY: boolean): boolean {
  if (env['NO_COLOR'] !== undefined) return false;
  if (env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '0') return true;
  return isTTY;
}

const GOOD = new Set(['succeeded', 'complete', 'paid', 'enabled', 'ok', 'active']);
const BAD = new Set(['failed', 'canceled', 'expired', 'disabled', 'revoked']);

export function colorStatus(status: string, colors: Colors): string {
  if (GOOD.has(status)) return colors.green(status);
  if (BAD.has(status)) return colors.red(status);
  return colors.yellow(status);
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
export const stripAnsi = (text: string) => text.replace(ANSI_PATTERN, '');
export const visibleLength = (text: string) => stripAnsi(text).length;

/** Renders rows as left-aligned columns separated by two spaces. */
export function renderTable(headers: string[], rows: string[][], colors: Colors): string {
  const widths = headers.map((header, index) =>
    Math.max(visibleLength(header), ...rows.map((row) => visibleLength(row[index] ?? ''))),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) =>
        index === cells.length - 1
          ? cell
          : cell + ' '.repeat((widths[index] ?? 0) - visibleLength(cell)),
      )
      .join('  ')
      .trimEnd();
  return [colors.bold(line(headers)), ...rows.map(line)].join('\n');
}

const TIMESTAMP_KEYS = new Set([
  'created',
  'canceled_at',
  'expires_at',
  'last_attempt_at',
  'next_attempt_at',
  'last_used_at',
]);
const AMOUNT_KEY = /^amount(_|$)|_amount$/;

/** Renders an object's top-level fields as aligned `key  value` lines. */
export function renderDetails(object: Record<string, unknown>, colors: Colors): string {
  const currency = typeof object['currency'] === 'string' ? object['currency'] : undefined;
  const entries = Object.entries(object).map(([key, value]): [string, string] => {
    if (value === null || value === undefined) return [key, colors.dim('-')];
    if (typeof value === 'number' && TIMESTAMP_KEYS.has(key)) return [key, formatDate(value)];
    if (typeof value === 'number' && currency && AMOUNT_KEY.test(key)) {
      return [key, formatAmount(value, currency)];
    }
    if (key === 'status' && typeof value === 'string') return [key, colorStatus(value, colors)];
    if (typeof value === 'object') return [key, JSON.stringify(value)];
    return [key, String(value)];
  });
  const width = Math.max(...entries.map(([key]) => key.length));
  return entries.map(([key, value]) => `${colors.dim(key.padEnd(width))}  ${value}`).join('\n');
}
