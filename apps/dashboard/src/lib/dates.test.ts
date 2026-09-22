import { describe, expect, it } from 'vitest';
import { formatRelative } from './dates';

const now = Date.UTC(2026, 0, 10, 12, 0, 0);
const seconds = now / 1000;

describe('formatRelative', () => {
  it('formats past and future timestamps', () => {
    expect(formatRelative(seconds - 10, now, 'en')).toBe('just now');
    expect(formatRelative(seconds - 5 * 60, now, 'en')).toBe('5 minutes ago');
    expect(formatRelative(seconds - 3 * 3600, now, 'en')).toBe('3 hours ago');
    expect(formatRelative(seconds - 24 * 3600, now, 'en')).toBe('yesterday');
    expect(formatRelative(seconds + 2 * 3600, now, 'en')).toBe('in 2 hours');
  });
});
