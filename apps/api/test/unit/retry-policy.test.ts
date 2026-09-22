import { describe, expect, it } from 'vitest';
import { isSuccessfulResponse, nextRetryAt } from '../../src/modules/webhooks/retry-policy.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const delayAfter = (attempts: number, baseDelayMs: number, maxAttempts = 10) => {
  const next = nextRetryAt(attempts, { maxAttempts, baseDelayMs }, NOW);
  return next ? next.getTime() - NOW.getTime() : null;
};

describe('nextRetryAt', () => {
  it('backs off exponentially with factor 3', () => {
    expect([1, 2, 3, 4].map((attempt) => delayAfter(attempt, 1000))).toEqual([
      1000, 3000, 9000, 27_000,
    ]);
  });

  it('caps the delay at one hour', () => {
    expect(delayAfter(3, 10 * 60_000)).toBe(60 * 60_000);
    expect(delayAfter(9, 10_000)).toBe(60 * 60_000);
  });

  it('returns null once the attempts are exhausted', () => {
    expect(delayAfter(4, 1000, 5)).toBe(27_000);
    expect(delayAfter(5, 1000, 5)).toBeNull();
    expect(delayAfter(6, 1000, 5)).toBeNull();
    expect(delayAfter(1, 1000, 1)).toBeNull();
  });

  it('retries immediately with a zero base delay', () => {
    expect(delayAfter(2, 0)).toBe(0);
  });
});

describe('isSuccessfulResponse', () => {
  it.each([
    [200, true],
    [204, true],
    [299, true],
    [199, false],
    [301, false],
    [404, false],
    [500, false],
  ])('%i → %s', (status, expected) => {
    expect(isSuccessfulResponse(status)).toBe(expected);
  });
});
