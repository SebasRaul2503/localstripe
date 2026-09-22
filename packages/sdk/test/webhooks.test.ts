import { describe, expect, it } from 'vitest';
import { LocalStripe, WebhookSignatureVerificationError } from '../src/index.js';

const secret = 'whsec_unit_test_secret';
const event = { id: 'evt_1', object: 'event', type: 'payment_intent.succeeded', data: {} };
const payload = JSON.stringify(event);
const now = () => Math.floor(Date.now() / 1000);

function reasonOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WebhookSignatureVerificationError);
    return (error as WebhookSignatureVerificationError).reason;
  }
  throw new Error('expected verification to fail');
}

describe('webhooks', () => {
  it('round-trips a generated header', () => {
    const header = LocalStripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(LocalStripe.webhooks.constructEvent(payload, header, secret)).toEqual(event);
  });

  it('accepts Buffer payloads and is available on instances', () => {
    const localstripe = new LocalStripe({ apiKey: 'sk_test_x' });
    const header = localstripe.webhooks.generateTestHeaderString({
      payload: Buffer.from(payload),
      secret,
    });
    expect(localstripe.webhooks.constructEvent(Buffer.from(payload), header, secret).id).toBe(
      'evt_1',
    );
  });

  it('rejects a tampered payload', () => {
    const header = LocalStripe.webhooks.generateTestHeaderString({ payload, secret });
    const tampered = payload.replace('evt_1', 'evt_2');
    expect(reasonOf(() => LocalStripe.webhooks.constructEvent(tampered, header, secret))).toBe(
      'no_matching_signature',
    );
  });

  it('rejects the wrong secret', () => {
    const header = LocalStripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(
      reasonOf(() => LocalStripe.webhooks.constructEvent(payload, header, 'whsec_other')),
    ).toBe('no_matching_signature');
  });

  it('enforces the timestamp tolerance', () => {
    const header = LocalStripe.webhooks.generateTestHeaderString({
      payload,
      secret,
      timestamp: now() - 600,
    });
    expect(reasonOf(() => LocalStripe.webhooks.constructEvent(payload, header, secret))).toBe(
      'timestamp_outside_tolerance',
    );
    expect(LocalStripe.webhooks.constructEvent(payload, header, secret, 900).id).toBe('evt_1');
    expect(LocalStripe.webhooks.constructEvent(payload, header, secret, 0).id).toBe('evt_1');
  });

  it('reports missing and malformed headers', () => {
    expect(reasonOf(() => LocalStripe.webhooks.constructEvent(payload, undefined, secret))).toBe(
      'missing_header',
    );
    expect(reasonOf(() => LocalStripe.webhooks.constructEvent(payload, 'garbage', secret))).toBe(
      'malformed_header',
    );
  });

  it('reports a signed but invalid JSON payload', () => {
    const header = LocalStripe.webhooks.generateTestHeaderString({ payload: 'not json', secret });
    expect(reasonOf(() => LocalStripe.webhooks.constructEvent('not json', header, secret))).toBe(
      'invalid_payload',
    );
  });
});
