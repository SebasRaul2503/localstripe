import { ApiError, invalidRequest } from '../../shared/errors.js';

export interface RefundableCharge {
  id: string;
  status: string;
  amount: number;
  amountRefunded: number;
}

export const remainingRefundable = (charge: RefundableCharge): number =>
  Math.max(charge.amount - charge.amountRefunded, 0);

/** Decides the refund amount, or explains why the refund is not possible. */
export function computeRefundAmount(
  charge: RefundableCharge,
  requested: number | undefined,
): number {
  if (charge.status !== 'succeeded') {
    throw invalidRequest(`Charge ${charge.id} has not succeeded, so it cannot be refunded.`, {
      param: 'charge',
    });
  }
  const remaining = remainingRefundable(charge);
  if (remaining === 0) {
    throw new ApiError(
      400,
      'invalid_request_error',
      `Charge ${charge.id} has already been refunded.`,
      {
        code: 'charge_already_refunded',
      },
    );
  }
  if (requested === undefined) return remaining;
  if (requested <= 0) {
    throw invalidRequest('Refund amount must be a positive integer.', {
      code: 'amount_too_small',
      param: 'amount',
    });
  }
  if (requested > remaining) {
    throw invalidRequest(
      `Refund amount (${requested}) is greater than the unrefunded amount on charge (${remaining}).`,
      { code: 'amount_too_large', param: 'amount' },
    );
  }
  return requested;
}
