import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, type IdKind, newId, randomToken } from '../../src/shared/ids.js';

const ULID = '[0-9A-HJKMNP-TV-Z]{26}';

describe('newId', () => {
  it('formats ids as <prefix>_local_<ULID>', () => {
    expect(newId('paymentIntent')).toMatch(new RegExp(`^pi_local_${ULID}$`));
    for (const kind of Object.keys(ID_PREFIXES) as IdKind[]) {
      expect(newId(kind)).toMatch(new RegExp(`^${ID_PREFIXES[kind]}_local_${ULID}$`));
    }
  });

  it('is strictly increasing, even within the same millisecond', () => {
    const ids = Array.from({ length: 2000 }, () => newId('customer'));
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('randomToken', () => {
  it('returns base62 tokens of the requested length', () => {
    for (const length of [1, 16, 32, 100]) {
      expect(randomToken(length)).toMatch(new RegExp(`^[0-9A-Za-z]{${length}}$`));
    }
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => randomToken(24)));
    expect(tokens.size).toBe(500);
  });
});
