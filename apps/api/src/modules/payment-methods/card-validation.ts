import { cardError } from '../../shared/errors.js';
import type { CatalogCard, TestCardCatalog } from '../test-cards/catalog.js';

export interface CardInput {
  number: string;
  exp_month: number;
  exp_year: number;
  cvc?: string;
}

export interface ValidatedCard {
  card: CatalogCard;
  expMonth: number;
  expYear: number;
}

/**
 * Accepts a card only if its number is in the test card catalog. The number and CVC are used
 * for validation only and are never returned, stored or logged.
 */
export function validateCard(
  input: CardInput,
  catalog: TestCardCatalog,
  now: Date = new Date(),
): ValidatedCard {
  const card = catalog.findByNumber(input.number);
  if (!card) {
    throw cardError(
      'Your card number is not a LocalStripe test card. LocalStripe only accepts the numbers listed at GET /v1/localstripe/test_cards and never processes real cards.',
      { code: 'incorrect_number', param: 'card[number]' },
    );
  }

  if (input.exp_month < 1 || input.exp_month > 12) {
    throw cardError("Your card's expiration month is invalid.", {
      code: 'invalid_expiry_month',
      param: 'card[exp_month]',
    });
  }
  const expYear = input.exp_year < 100 ? 2000 + input.exp_year : input.exp_year;
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (expYear < currentYear || expYear > currentYear + 50) {
    throw cardError("Your card's expiration year is invalid.", {
      code: 'invalid_expiry_year',
      param: 'card[exp_year]',
    });
  }
  if (expYear === currentYear && input.exp_month < currentMonth) {
    throw cardError("Your card's expiration month is invalid.", {
      code: 'invalid_expiry_month',
      param: 'card[exp_month]',
    });
  }

  if (input.cvc !== undefined) {
    const expectedLength = card.brand === 'amex' ? 4 : 3;
    if (!new RegExp(`^\\d{${expectedLength}}$`).test(input.cvc)) {
      throw cardError("Your card's security code is invalid.", {
        code: 'incorrect_cvc',
        param: 'card[cvc]',
      });
    }
  }

  return { card, expMonth: input.exp_month, expYear };
}
