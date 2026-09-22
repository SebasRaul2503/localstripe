import { describe, expect, it } from 'vitest';
import { currencyExponent, formatMoney, toMajorUnits, toMinorUnits } from './money';

describe('currencyExponent', () => {
  it('knows zero- and three-decimal currencies', () => {
    expect(currencyExponent('usd')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('clp')).toBe(0);
    expect(currencyExponent('krw')).toBe(0);
    expect(currencyExponent('kwd')).toBe(3);
  });
});

describe('formatMoney', () => {
  it('formats minor units in two-decimal currencies', () => {
    expect(formatMoney(123456, 'usd', 'en-US')).toBe('$1,234.56');
    expect(formatMoney(5, 'eur', 'en-US')).toBe('€0.05');
    expect(formatMoney(2000, 'pen', 'en-US').replace(/\s/g, ' ')).toBe('PEN 20.00');
  });

  it('does not divide zero-decimal currencies', () => {
    expect(formatMoney(1500, 'jpy', 'en-US')).toBe('¥1,500');
    expect(formatMoney(9990, 'clp', 'en-US').replace(/\s/g, ' ')).toBe('CLP 9,990');
    expect(formatMoney(50000, 'krw', 'en-US')).toBe('₩50,000');
  });

  it('handles negative amounts', () => {
    expect(formatMoney(-2500, 'usd', 'en-US')).toBe('-$25.00');
  });
});

describe('unit conversion', () => {
  it('converts minor to major units', () => {
    expect(toMajorUnits(1999, 'usd')).toBe(19.99);
    expect(toMajorUnits(1999, 'jpy')).toBe(1999);
  });

  it('parses major-unit input to minor units', () => {
    expect(toMinorUnits('12.5', 'usd')).toBe(1250);
    expect(toMinorUnits('1,000.01', 'usd')).toBe(100001);
    expect(toMinorUnits('0.1', 'usd')).toBe(10);
    expect(toMinorUnits('1500', 'jpy')).toBe(1500);
    expect(toMinorUnits('1.234', 'kwd')).toBe(1234);
  });

  it('rejects invalid or over-precise input', () => {
    expect(toMinorUnits('', 'usd')).toBeNull();
    expect(toMinorUnits('abc', 'usd')).toBeNull();
    expect(toMinorUnits('-5', 'usd')).toBeNull();
    expect(toMinorUnits('1.999', 'usd')).toBeNull();
    expect(toMinorUnits('10.5', 'jpy')).toBeNull();
  });
});
