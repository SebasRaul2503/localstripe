import type { CatalogCard } from '../test-cards/catalog.js';

export interface Decline {
  code: string;
  declineCode: string | null;
  message: string;
}

export type ConfirmOutcome =
  | { kind: 'succeeded' }
  | { kind: 'declined'; decline: Decline }
  | { kind: 'requires_action' }
  | { kind: 'processing' };

export type SettlementOutcome = { kind: 'succeeded' } | { kind: 'declined'; decline: Decline };

const MESSAGES: Record<string, string> = {
  insufficient_funds: 'Your card has insufficient funds.',
  expired_card: 'Your card has expired.',
  incorrect_cvc: "Your card's security code is incorrect.",
  processing_error: 'An error occurred while processing your card.',
  lost_card: 'Your card was declined.',
  stolen_card: 'Your card was declined.',
};

export function declineFor(card: CatalogCard): Decline {
  const declineCode = card.decline_code ?? null;
  const base = MESSAGES[declineCode ?? card.error_code ?? ''] ?? 'Your card was declined.';
  return {
    code: card.error_code ?? 'card_declined',
    declineCode,
    message: `${base} (Simulated by LocalStripe; no real payment was attempted.)`,
  };
}

export const AUTHENTICATION_FAILURE: Decline = {
  code: 'payment_intent_authentication_failure',
  declineCode: null,
  message:
    'The provided payment method failed the simulated 3D Secure authentication. Provide a new payment method to attempt to fulfill this PaymentIntent again.',
};

export function decideConfirmOutcome(card: CatalogCard): ConfirmOutcome {
  switch (card.scenario) {
    case 'succeeded':
      return { kind: 'succeeded' };
    case 'declined':
      return { kind: 'declined', decline: declineFor(card) };
    case 'requires_action':
      return { kind: 'requires_action' };
    case 'processing':
      return { kind: 'processing' };
  }
}

export function decideSettlementOutcome(card: CatalogCard): SettlementOutcome {
  return card.settles_to === 'declined'
    ? { kind: 'declined', decline: declineFor(card) }
    : { kind: 'succeeded' };
}
