import { describe, expect, it } from 'vitest';
import { type CardInput, validateCard } from '../../src/modules/payment-methods/card-validation.js';
import { TestCardCatalog } from '../../src/modules/test-cards/catalog.js';
import { DEFAULT_TEST_CARDS } from '../../src/modules/test-cards/default-catalog.js';
import { ApiError } from '../../src/shared/errors.js';

const catalog = new TestCardCatalog(DEFAULT_TEST_CARDS);
const NOW = new Date(Date.UTC(2026, 5, 15));
const VISA = '4242424242424242';
const AMEX = '378282246310005';

const validate = (input: Partial<CardInput>) =>
  validateCard({ number: VISA, exp_month: 12, exp_year: 2030, ...input }, catalog, NOW);

function cardErrorOf(input: Partial<CardInput>): ApiError {
  try {
    validate(input);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected a card error');
}

describe('validateCard', () => {
  it('accepts a catalog card and returns its definition', () => {
    const result = validate({ number: '4242 4242 4242 4242', cvc: '123' });
    expect(result.card.id).toBe('visa_success');
    expect(result).toMatchObject({ expMonth: 12, expYear: 2030 });
  });

  it('rejects numbers outside the catalog as a 402 incorrect_number card error', () => {
    const error = cardErrorOf({ number: '4111111111111111' });
    expect(error.statusCode).toBe(402);
    expect(error.type).toBe('card_error');
    expect(error.options).toMatchObject({ code: 'incorrect_number', param: 'card[number]' });
    expect(error.message).not.toContain('4111111111111111');
  });

  it.each([0, 13])('rejects exp_month=%i', (month) => {
    expect(cardErrorOf({ exp_month: month }).options).toMatchObject({
      code: 'invalid_expiry_month',
      param: 'card[exp_month]',
    });
  });

  it.each([2025, 2077, 25])('rejects exp_year=%i', (year) => {
    expect(cardErrorOf({ exp_year: year }).options).toMatchObject({
      code: 'invalid_expiry_year',
      param: 'card[exp_year]',
    });
  });

  it('rejects an expiry earlier in the current year', () => {
    expect(cardErrorOf({ exp_month: 5, exp_year: 2026 }).options.code).toBe('invalid_expiry_month');
  });

  it('accepts the current month and the furthest allowed year', () => {
    expect(validate({ exp_month: 6, exp_year: 2026 }).expYear).toBe(2026);
    expect(validate({ exp_year: 2076 }).expYear).toBe(2076);
  });

  it('expands two-digit years', () => {
    expect(validate({ exp_year: 30 }).expYear).toBe(2030);
    expect(validate({ exp_month: 6, exp_year: 26 }).expYear).toBe(2026);
  });

  it.each([
    [VISA, '123', true],
    [VISA, '1234', false],
    [VISA, '12', false],
    [VISA, 'abc', false],
    [AMEX, '1234', true],
    [AMEX, '123', false],
  ])('number %s with cvc %s → valid=%s', (number, cvc, valid) => {
    if (valid) {
      expect(() => validate({ number, cvc })).not.toThrow();
    } else {
      expect(cardErrorOf({ number, cvc }).options).toMatchObject({
        code: 'incorrect_cvc',
        param: 'card[cvc]',
      });
    }
  });

  it('does not require a cvc', () => {
    expect(() => validate({ number: AMEX })).not.toThrow();
  });
});
