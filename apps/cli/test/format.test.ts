import { describe, expect, it } from 'vitest';
import {
  createColors,
  formatAmount,
  formatDate,
  renderDetails,
  renderTable,
  shouldUseColor,
  stripAnsi,
  visibleLength,
} from '../src/format.js';

const plain = createColors(false);

describe('formatAmount', () => {
  it('formats two-decimal currencies from minor units', () => {
    expect(formatAmount(1990, 'pen')).toBe('19.90 PEN');
    expect(formatAmount(123456789, 'usd')).toBe('1,234,567.89 USD');
    expect(formatAmount(5, 'eur')).toBe('0.05 EUR');
  });

  it('formats zero-decimal currencies as whole units', () => {
    expect(formatAmount(1500, 'jpy')).toBe('1,500 JPY');
    expect(formatAmount(20000, 'CLP')).toBe('20,000 CLP');
  });
});

describe('formatDate', () => {
  it('prints ISO timestamps without milliseconds', () => {
    expect(formatDate(1_790_000_000)).toBe('2026-09-21T14:13:20Z');
    expect(formatDate(null)).toBe('-');
  });
});

describe('colors', () => {
  it('respects NO_COLOR and FORCE_COLOR', () => {
    expect(shouldUseColor({}, true)).toBe(true);
    expect(shouldUseColor({}, false)).toBe(false);
    expect(shouldUseColor({ NO_COLOR: '' }, true)).toBe(false);
    expect(shouldUseColor({ FORCE_COLOR: '1' }, false)).toBe(true);
  });

  it('measures visible length ignoring ANSI codes', () => {
    expect(visibleLength(createColors(true).green('ok'))).toBe(2);
  });
});

describe('renderTable', () => {
  it('aligns columns, including colored cells', () => {
    const colors = createColors(true);
    const table = renderTable(
      ['ID', 'STATUS', 'AMOUNT'],
      [
        ['pi_1', colors.green('succeeded'), '1.00 USD'],
        ['pi_22', colors.red('canceled'), '10.00 USD'],
      ],
      plain,
    );
    const lines = table.split('\n').map(stripAnsi);
    expect(lines).toEqual([
      'ID     STATUS     AMOUNT',
      'pi_1   succeeded  1.00 USD',
      'pi_22  canceled   10.00 USD',
    ]);
  });
});

describe('renderDetails', () => {
  it('formats amounts, timestamps, nulls and nested objects', () => {
    const output = renderDetails(
      {
        id: 'pi_1',
        amount: 1990,
        amount_received: 0,
        currency: 'pen',
        created: 1_790_000_000,
        customer: null,
        metadata: { order: '1' },
      },
      plain,
    );
    expect(output.split('\n')).toEqual([
      'id               pi_1',
      'amount           19.90 PEN',
      'amount_received  0.00 PEN',
      'currency         pen',
      'created          2026-09-21T14:13:20Z',
      'customer         -',
      'metadata         {"order":"1"}',
    ]);
  });
});
