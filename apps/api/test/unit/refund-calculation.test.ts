import { describe, expect, it } from 'vitest';
import {
  type RefundableCharge,
  computeRefundAmount,
  remainingRefundable,
} from '../../src/modules/refunds/refund-calculation.js';
import { ApiError } from '../../src/shared/errors.js';

const charge = (overrides: Partial<RefundableCharge> = {}): RefundableCharge => ({
  id: 'ch_local_1',
  status: 'succeeded',
  amount: 1000,
  amountRefunded: 0,
  ...overrides,
});

function errorOf(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError');
}

describe('computeRefundAmount', () => {
  it('refunds the full amount by default', () => {
    expect(computeRefundAmount(charge(), undefined)).toBe(1000);
  });

  it('defaults to the remaining amount after partial refunds', () => {
    expect(computeRefundAmount(charge({ amountRefunded: 300 }), undefined)).toBe(700);
  });

  it('accepts a partial amount', () => {
    expect(computeRefundAmount(charge(), 250)).toBe(250);
  });

  it('accepts exactly the remaining amount', () => {
    expect(computeRefundAmount(charge({ amountRefunded: 400 }), 600)).toBe(600);
  });

  it('rejects more than the remaining amount with amount_too_large', () => {
    const error = errorOf(() => computeRefundAmount(charge({ amountRefunded: 400 }), 601));
    expect(error.statusCode).toBe(400);
    expect(error.options).toMatchObject({ code: 'amount_too_large', param: 'amount' });
  });

  it('rejects a fully refunded charge with charge_already_refunded', () => {
    const error = errorOf(() => computeRefundAmount(charge({ amountRefunded: 1000 }), undefined));
    expect(error.options.code).toBe('charge_already_refunded');
    expect(
      errorOf(() => computeRefundAmount(charge({ amountRefunded: 1000 }), 1)).options.code,
    ).toBe('charge_already_refunded');
  });

  it.each(['failed', 'pending'])('rejects a %s charge', (status) => {
    const error = errorOf(() => computeRefundAmount(charge({ status }), undefined));
    expect(error.statusCode).toBe(400);
    expect(error.options.param).toBe('charge');
  });

  it.each([0, -5])('rejects a non-positive amount %i', (amount) => {
    expect(errorOf(() => computeRefundAmount(charge(), amount)).options.code).toBe(
      'amount_too_small',
    );
  });
});

describe('remainingRefundable', () => {
  it('never goes below zero', () => {
    expect(remainingRefundable(charge({ amountRefunded: 1200 }))).toBe(0);
    expect(remainingRefundable(charge({ amountRefunded: 200 }))).toBe(800);
  });
});
