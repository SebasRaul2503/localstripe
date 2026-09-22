import { describe, expect, it } from 'vitest';
import {
  buildSignatureHeader,
  computeSignature,
  parseSignatureHeader,
  verifySignature,
} from '../src/signature.js';

const secret = 'whsec_test_secret';
const payload = JSON.stringify({ id: 'evt_local_1', type: 'payment_intent.succeeded' });

describe('webhook signatures', () => {
  it('produces a Stripe-style header', () => {
    const header = buildSignatureHeader(payload, secret, 1_700_000_000);
    expect(header).toBe(`t=1700000000,v1=${computeSignature(payload, secret, 1_700_000_000)}`);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('verifies a valid signature', () => {
    const header = buildSignatureHeader(payload, secret, 1_700_000_000);
    expect(verifySignature(payload, header, secret, { now: 1_700_000_010 })).toEqual({
      ok: true,
      timestamp: 1_700_000_000,
    });
  });

  it('rejects a tampered payload', () => {
    const header = buildSignatureHeader(payload, secret, 1_700_000_000);
    const result = verifySignature(`${payload} `, header, secret, { now: 1_700_000_000 });
    expect(result).toEqual({ ok: false, reason: 'no_matching_signature' });
  });

  it('rejects the wrong secret', () => {
    const header = buildSignatureHeader(payload, secret, 1_700_000_000);
    const result = verifySignature(payload, header, 'whsec_other', { now: 1_700_000_000 });
    expect(result.ok).toBe(false);
  });

  it('rejects timestamps outside the tolerance window', () => {
    const header = buildSignatureHeader(payload, secret, 1_700_000_000);
    const result = verifySignature(payload, header, secret, { now: 1_700_001_000 });
    expect(result).toEqual({ ok: false, reason: 'timestamp_outside_tolerance' });
  });

  it('accepts any matching signature when several are present (secret rotation)', () => {
    const good = computeSignature(payload, secret, 1_700_000_000);
    const header = `t=1700000000,v1=${'0'.repeat(64)},v1=${good}`;
    expect(verifySignature(payload, header, secret, { now: 1_700_000_000 }).ok).toBe(true);
  });

  it('rejects malformed headers', () => {
    expect(parseSignatureHeader('garbage')).toBeNull();
    expect(parseSignatureHeader('t=abc,v1=00')).toBeNull();
    expect(verifySignature(payload, 'v1=abc', secret)).toEqual({
      ok: false,
      reason: 'malformed_header',
    });
  });
});
