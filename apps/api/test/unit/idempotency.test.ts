import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  requestFingerprint,
} from '../../src/modules/idempotency/idempotency.service.js';

describe('canonicalJson', () => {
  it('is independent of key order, at every level', () => {
    const a = { amount: 100, metadata: { b: '2', a: '1' }, currency: 'usd' };
    const b = { currency: 'usd', metadata: { a: '1', b: '2' }, amount: 100 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"amount":100,"currency":"usd","metadata":{"a":"1","b":"2"}}');
  });

  it('keeps array order significant', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ items: [{ b: 1, a: 2 }] })).toBe('{"items":[{"a":2,"b":1}]}');
  });

  it('drops undefined properties and renders null and scalars', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson('x"y')).toBe('"x\\"y"');
    expect(canonicalJson(true)).toBe('true');
  });

  it('distinguishes values of different types', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: '1' }));
  });
});

describe('requestFingerprint', () => {
  const body = { amount: 100, currency: 'usd' };
  const fingerprint = requestFingerprint('POST', '/v1/payment_intents', body);

  it('is a sha256 hex digest', () => {
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across key order and method case', () => {
    expect(
      requestFingerprint('post', '/v1/payment_intents', { currency: 'usd', amount: 100 }),
    ).toBe(fingerprint);
  });

  it('changes with the body, the path or the method', () => {
    expect(requestFingerprint('POST', '/v1/payment_intents', { ...body, amount: 101 })).not.toBe(
      fingerprint,
    );
    expect(requestFingerprint('POST', '/v1/customers', body)).not.toBe(fingerprint);
    expect(requestFingerprint('DELETE', '/v1/payment_intents', body)).not.toBe(fingerprint);
  });
});
