import { describe, expect, it } from 'vitest';
import { PAYMENT_INTENT_STATUSES, type PaymentIntentStatus } from '@localstripe/contracts';
import {
  type PaymentIntentAction,
  assertActionAllowed,
  assertTransition,
  canTransition,
  isActionAllowed,
  isTerminal,
} from '../../src/modules/payment-intents/state-machine.js';
import { ApiError } from '../../src/shared/errors.js';

const ALLOWED: Record<PaymentIntentStatus, PaymentIntentStatus[]> = {
  requires_payment_method: [
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
    'succeeded',
    'canceled',
  ],
  requires_confirmation: [
    'requires_payment_method',
    'requires_action',
    'processing',
    'succeeded',
    'canceled',
  ],
  requires_action: ['requires_payment_method', 'processing', 'succeeded', 'canceled'],
  processing: ['requires_payment_method', 'succeeded'],
  succeeded: [],
  canceled: [],
};

const ACTIONS: Record<PaymentIntentAction, PaymentIntentStatus[]> = {
  confirm: ['requires_payment_method', 'requires_confirmation'],
  cancel: ['requires_payment_method', 'requires_confirmation', 'requires_action'],
  update: ['requires_payment_method', 'requires_confirmation'],
  authenticate: ['requires_action'],
  settle: ['processing'],
};

const pairs = PAYMENT_INTENT_STATUSES.flatMap((from) =>
  PAYMENT_INTENT_STATUSES.map((to) => ({ from, to, allowed: ALLOWED[from].includes(to) })),
);

describe('PaymentIntent transitions', () => {
  it.each(pairs.filter((pair) => pair.allowed))('allows $from → $to', ({ from, to }) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition('pi_x', from, to)).not.toThrow();
  });

  it.each(pairs.filter((pair) => !pair.allowed))('forbids $from → $to', ({ from, to }) => {
    expect(canTransition(from, to)).toBe(false);
    let error: unknown;
    try {
      assertTransition('pi_x', from, to);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      statusCode: 400,
      type: 'invalid_request_error',
      options: { code: 'payment_intent_unexpected_state' },
    });
  });

  it('marks only succeeded and canceled as terminal', () => {
    const terminal = PAYMENT_INTENT_STATUSES.filter((status) => isTerminal(status));
    expect(terminal.sort()).toEqual(['canceled', 'succeeded']);
  });
});

describe('PaymentIntent action guards', () => {
  const cases = (Object.keys(ACTIONS) as PaymentIntentAction[]).flatMap((action) =>
    PAYMENT_INTENT_STATUSES.map((status) => ({
      action,
      status,
      allowed: ACTIONS[action].includes(status),
    })),
  );

  it.each(cases)('$action from $status → allowed=$allowed', ({ action, status, allowed }) => {
    expect(isActionAllowed(status, action)).toBe(allowed);
    if (allowed) {
      expect(() => assertActionAllowed('pi_x', status, action)).not.toThrow();
    } else {
      expect(() => assertActionAllowed('pi_x', status, action)).toThrow(
        new RegExp(
          `cannot ${action} this PaymentIntent \\(pi_x\\) because it has a status of ${status}`,
        ),
      );
    }
  });
});
