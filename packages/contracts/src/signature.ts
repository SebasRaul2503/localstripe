import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signatures use the same scheme as Stripe (`t=<ts>,v1=<hex hmac>` over `${t}.${payload}`,
 * keyed with the full `whsec_...` secret) so that `stripe.webhooks.constructEvent` also works.
 */
export const SIGNATURE_SCHEME = 'v1';
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

export function computeSignature(payload: string, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
}

export function buildSignatureHeader(payload: string, secret: string, timestamp: number): string {
  return `t=${timestamp},${SIGNATURE_SCHEME}=${computeSignature(payload, secret, timestamp)}`;
}

export interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

export function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp = Number.NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === SIGNATURE_SCHEME) signatures.push(value);
  }
  if (!Number.isInteger(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export type SignatureVerificationFailure =
  'malformed_header' | 'no_matching_signature' | 'timestamp_outside_tolerance';

export function verifySignature(
  payload: string,
  header: string,
  secret: string,
  options: { toleranceSeconds?: number; now?: number } = {},
): { ok: true; timestamp: number } | { ok: false; reason: SignatureVerificationFailure } {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed_header' };

  const expected = Buffer.from(computeSignature(payload, secret, parsed.timestamp), 'utf8');
  const matches = parsed.signatures.some((candidate) => {
    const actual = Buffer.from(candidate, 'utf8');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!matches) return { ok: false, reason: 'no_matching_signature' };

  const tolerance = options.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && Math.abs(now - parsed.timestamp) > tolerance) {
    return { ok: false, reason: 'timestamp_outside_tolerance' };
  }
  return { ok: true, timestamp: parsed.timestamp };
}
