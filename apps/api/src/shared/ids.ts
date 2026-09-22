import { randomBytes } from 'node:crypto';
import { monotonicFactory } from 'ulid';

const nextUlid = monotonicFactory();

export const ID_PREFIXES = {
  customer: 'cus',
  paymentMethod: 'pm',
  paymentIntent: 'pi',
  charge: 'ch',
  refund: 're',
  checkoutSession: 'cs',
  lineItem: 'li',
  event: 'evt',
  webhookEndpoint: 'we',
  webhookDelivery: 'wd',
  webhookDeliveryAttempt: 'wda',
  apiKey: 'key',
  job: 'job',
  request: 'req',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/**
 * IDs are `<prefix>_local_<ULID>`: the `_local_` marker makes LocalStripe objects impossible to
 * confuse with real Stripe objects, and ULIDs sort by creation time, which keyset pagination relies on.
 */
export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_local_${nextUlid()}`;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomToken(length: number): string {
  // Rejection sampling keeps the distribution uniform over the alphabet.
  const out: string[] = [];
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) out.push(BASE62[byte % 62]!);
    }
  }
  return out.join('');
}
