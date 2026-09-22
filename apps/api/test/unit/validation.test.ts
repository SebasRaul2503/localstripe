import { describe, expect, it } from 'vitest';
import {
  MAX_METADATA_KEYS,
  amount,
  applyMetadata,
  boolean,
  createMetadata,
  currency,
  email,
  integer,
  metadata,
  nullableString,
} from '../../src/shared/validation.js';
import { diff, escapeLike } from '../../src/shared/objects.js';

describe('integer', () => {
  it('accepts numbers and their form-encoded strings', () => {
    expect(integer().parse(1990)).toBe(1990);
    expect(integer().parse('1990')).toBe(1990);
    expect(integer().parse('-5')).toBe(-5);
  });

  it.each(['1.5', 'abc', '', '1e3', 1.5])('rejects %j', (value) => {
    expect(integer().safeParse(value).success).toBe(false);
  });

  it('enforces bounds', () => {
    expect(integer({ min: 1, max: 10 }).safeParse('0').success).toBe(false);
    expect(integer({ min: 1, max: 10 }).safeParse('11').success).toBe(false);
    expect(integer({ min: 1, max: 10 }).parse('10')).toBe(10);
  });

  it('amount() requires a positive amount below 100M', () => {
    expect(amount().safeParse('0').success).toBe(false);
    expect(amount().safeParse(100_000_000).success).toBe(false);
    expect(amount().parse('99999999')).toBe(99_999_999);
  });
});

describe('boolean', () => {
  it.each([
    [true, true],
    ['true', true],
    [false, false],
    ['false', false],
  ])('%j → %s', (input, expected) => {
    expect(boolean().parse(input)).toBe(expected);
  });

  it.each(['yes', '1', 1, ''])('rejects %j', (value) => {
    expect(boolean().safeParse(value).success).toBe(false);
  });
});

describe('string helpers', () => {
  it('nullableString turns "" into null', () => {
    expect(nullableString().parse('')).toBeNull();
    expect(nullableString().parse('x')).toBe('x');
    expect(nullableString(3).safeParse('abcd').success).toBe(false);
  });

  it('email accepts "" as unset and rejects malformed addresses', () => {
    expect(email().parse('')).toBeNull();
    expect(email().parse('ada@example.test')).toBe('ada@example.test');
    expect(email().safeParse('not-an-email').success).toBe(false);
  });

  it('currency lower-cases three-letter codes', () => {
    expect(currency().parse('USD')).toBe('usd');
    expect(currency().safeParse('US').success).toBe(false);
    expect(currency().safeParse('us1').success).toBe(false);
  });
});

describe('metadata', () => {
  it('turns "" values into deletions and stringifies scalars', () => {
    expect(metadata().parse({ a: '1', b: '', c: 2, d: true })).toEqual({
      a: '1',
      b: null,
      c: '2',
      d: 'true',
    });
  });

  it('turns metadata="" into a full clear', () => {
    expect(metadata().parse('')).toBeNull();
  });

  it(`accepts ${MAX_METADATA_KEYS} keys and rejects more`, () => {
    const keys = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`k${index}`, 'v']));
    expect(metadata().safeParse(keys(MAX_METADATA_KEYS)).success).toBe(true);
    expect(metadata().safeParse(keys(MAX_METADATA_KEYS + 1)).success).toBe(false);
  });

  it('limits key and value lengths', () => {
    expect(metadata().safeParse({ ['k'.repeat(41)]: 'v' }).success).toBe(false);
    expect(metadata().safeParse({ k: 'v'.repeat(501) }).success).toBe(false);
    expect(metadata().safeParse({ '': 'v' }).success).toBe(false);
  });

  it('rejects nested values', () => {
    expect(metadata().safeParse({ k: { nested: 'x' } }).success).toBe(false);
  });
});

describe('applyMetadata', () => {
  const current = { a: '1', b: '2' };

  it('keeps the current metadata when no update is given', () => {
    expect(applyMetadata(current, undefined)).toBe(current);
  });

  it('clears everything on null', () => {
    expect(applyMetadata(current, null)).toEqual({});
  });

  it('merges keys and deletes null values without mutating the input', () => {
    expect(applyMetadata(current, { b: null, c: '3', a: '9' })).toEqual({ a: '9', c: '3' });
    expect(current).toEqual({ a: '1', b: '2' });
  });

  it('createMetadata drops deletions', () => {
    expect(createMetadata({ a: '1', b: null })).toEqual({ a: '1' });
    expect(createMetadata(undefined)).toEqual({});
    expect(createMetadata(null)).toEqual({});
  });
});

describe('objects', () => {
  it('diff returns the previous values of changed top-level fields', () => {
    expect(
      diff(
        { name: 'a', email: 'x', metadata: { k: '1' } },
        { name: 'b', email: 'x', metadata: { k: '2' } },
      ),
    ).toEqual({ name: 'a', metadata: { k: '1' } });
  });

  it('escapeLike escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
