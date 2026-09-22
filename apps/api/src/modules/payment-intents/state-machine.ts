import type { PaymentIntentStatus } from '@localstripe/contracts';
import { unexpectedState } from '../../shared/errors.js';

/**
 * Every allowed PaymentIntent status transition. Anything not listed here is rejected, so the
 * lifecycle cannot be corrupted by concurrent requests or handler bugs.
 */
const TRANSITIONS: Record<PaymentIntentStatus, readonly PaymentIntentStatus[]> = {
  requires_payment_method: [
    'requires_confirmation',
    'requires_payment_method',
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

export type PaymentIntentAction = 'confirm' | 'cancel' | 'update' | 'authenticate' | 'settle';

/** Which statuses each operation may start from. */
const ACTION_SOURCES: Record<PaymentIntentAction, readonly PaymentIntentStatus[]> = {
  confirm: ['requires_payment_method', 'requires_confirmation'],
  cancel: ['requires_payment_method', 'requires_confirmation', 'requires_action'],
  update: ['requires_payment_method', 'requires_confirmation'],
  authenticate: ['requires_action'],
  settle: ['processing'],
};

export const canTransition = (from: PaymentIntentStatus, to: PaymentIntentStatus): boolean =>
  TRANSITIONS[from].includes(to);

export const isTerminal = (status: PaymentIntentStatus): boolean =>
  TRANSITIONS[status].length === 0;

export function assertTransition(
  id: string,
  from: PaymentIntentStatus,
  to: PaymentIntentStatus,
): void {
  if (!canTransition(from, to)) {
    throw unexpectedState(
      'payment_intent_unexpected_state',
      `This PaymentIntent (${id}) cannot move from status '${from}' to '${to}'.`,
    );
  }
}

export const isActionAllowed = (
  status: PaymentIntentStatus,
  action: PaymentIntentAction,
): boolean => ACTION_SOURCES[action].includes(status);

export function assertActionAllowed(
  id: string,
  status: PaymentIntentStatus,
  action: PaymentIntentAction,
): void {
  if (!isActionAllowed(status, action)) {
    throw unexpectedState(
      'payment_intent_unexpected_state',
      `You cannot ${action} this PaymentIntent (${id}) because it has a status of ${status}. ` +
        `Allowed statuses: ${ACTION_SOURCES[action].join(', ')}.`,
    );
  }
}

export const allowedTransitions = (): Readonly<typeof TRANSITIONS> => TRANSITIONS;
