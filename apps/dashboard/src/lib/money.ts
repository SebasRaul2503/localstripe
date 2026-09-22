/** ISO 4217 currencies whose minor unit is the major unit (Stripe's zero-decimal list). */
const ZERO_DECIMAL = new Set([
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

const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

export const COMMON_CURRENCIES = [
  'usd',
  'eur',
  'gbp',
  'pen',
  'mxn',
  'brl',
  'clp',
  'cop',
  'ars',
  'cad',
  'aud',
  'jpy',
  'krw',
  'inr',
  'chf',
] as const;

export function currencyExponent(currency: string): number {
  const code = currency.toLowerCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

export function isZeroDecimal(currency: string): boolean {
  return currencyExponent(currency) === 0;
}

export function toMajorUnits(amount: number, currency: string): number {
  return amount / 10 ** currencyExponent(currency);
}

/** Parses a user-typed major-unit amount ("12.50", "1,000") to minor units, or `null` if invalid. */
export function toMinorUnits(input: string, currency: string): number | null {
  const normalized = input.trim().replace(/[\s,_]/g, '');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const exponent = currencyExponent(currency);
  const [whole = '0', fraction = ''] = normalized.split('.');
  if (fraction.length > exponent) return null;
  const minor = Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

export function formatMoney(amount: number, currency: string, locale?: string): string {
  const code = currency.toUpperCase();
  const exponent = currencyExponent(currency);
  const major = amount / 10 ** exponent;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(major);
  } catch {
    return `${major.toFixed(exponent)} ${code}`;
  }
}
