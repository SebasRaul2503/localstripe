import { describe, expect, it } from 'vitest';
import {
  AUTHENTICATION_FAILURE,
  decideConfirmOutcome,
  decideSettlementOutcome,
  declineFor,
} from '../../src/modules/payment-intents/outcome.js';
import { TestCardCatalog } from '../../src/modules/test-cards/catalog.js';
import { DEFAULT_TEST_CARDS } from '../../src/modules/test-cards/default-catalog.js';

const catalog = new TestCardCatalog(DEFAULT_TEST_CARDS);
const card = (id: string) => catalog.findById(id)!;

describe('decideConfirmOutcome', () => {
  it.each([
    ['visa_success', 'succeeded'],
    ['generic_decline', 'declined'],
    ['authentication_required', 'requires_action'],
    ['local_processing', 'processing'],
    ['local_processing_declined', 'processing'],
  ])('%s → %s', (id, kind) => {
    expect(decideConfirmOutcome(card(id)).kind).toBe(kind);
  });

  it('attaches the decline details of declining cards', () => {
    expect(decideConfirmOutcome(card('insufficient_funds'))).toEqual({
      kind: 'declined',
      decline: {
        code: 'card_declined',
        declineCode: 'insufficient_funds',
        message: expect.stringMatching(/^Your card has insufficient funds\. \(Simulated/),
      },
    });
  });
});

describe('decideSettlementOutcome', () => {
  it('succeeds for cards settling to succeeded', () => {
    expect(decideSettlementOutcome(card('local_processing'))).toEqual({ kind: 'succeeded' });
  });

  it('declines for cards settling to declined', () => {
    expect(decideSettlementOutcome(card('local_processing_declined'))).toMatchObject({
      kind: 'declined',
      decline: { code: 'card_declined', declineCode: 'generic_decline' },
    });
  });
});

describe('declineFor', () => {
  it.each([
    ['expired_card', 'expired_card', 'expired_card', 'Your card has expired.'],
    ['incorrect_cvc', 'incorrect_cvc', 'incorrect_cvc', "Your card's security code is incorrect."],
    ['generic_decline', 'card_declined', 'generic_decline', 'Your card was declined.'],
  ])('%s → code %s / %s', (id, code, declineCode, message) => {
    const decline = declineFor(card(id));
    expect(decline.code).toBe(code);
    expect(decline.declineCode).toBe(declineCode);
    expect(decline.message.startsWith(message)).toBe(true);
    expect(decline.message).toContain('no real payment was attempted');
  });

  it('defaults the code to card_declined and the decline code to null', () => {
    const decline = declineFor({ ...card('visa_success'), error_code: undefined });
    expect(decline).toMatchObject({ code: 'card_declined', declineCode: null });
    expect(decline.message.startsWith('Your card was declined.')).toBe(true);
  });

  it('falls back to the error code for the message when there is no decline code', () => {
    const decline = declineFor({
      ...card('visa_success'),
      error_code: 'processing_error',
      decline_code: undefined,
    });
    expect(decline.message.startsWith('An error occurred while processing your card.')).toBe(true);
  });
});

it('describes 3DS failures with payment_intent_authentication_failure', () => {
  expect(AUTHENTICATION_FAILURE).toMatchObject({
    code: 'payment_intent_authentication_failure',
    declineCode: null,
  });
});
