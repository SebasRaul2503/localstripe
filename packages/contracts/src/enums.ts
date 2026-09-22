export const PAYMENT_INTENT_STATUSES = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'succeeded',
  'canceled',
] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

export const CANCELLATION_REASONS = [
  'duplicate',
  'fraudulent',
  'requested_by_customer',
  'abandoned',
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const CHARGE_STATUSES = ['succeeded', 'pending', 'failed'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const REFUND_STATUSES = ['pending', 'succeeded', 'failed', 'canceled'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const CHECKOUT_SESSION_STATUSES = ['open', 'complete', 'expired'] as const;
export type CheckoutSessionStatus = (typeof CHECKOUT_SESSION_STATUSES)[number];

export const CHECKOUT_PAYMENT_STATUSES = ['paid', 'unpaid', 'no_payment_required'] as const;
export type CheckoutPaymentStatus = (typeof CHECKOUT_PAYMENT_STATUSES)[number];

export const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover', 'unknown'] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export const CARD_FUNDING = ['credit', 'debit', 'prepaid', 'unknown'] as const;
export type CardFunding = (typeof CARD_FUNDING)[number];

/**
 * What LocalStripe does when a payment is confirmed with a given test card.
 * This is LocalStripe's own vocabulary and is not a Stripe concept.
 */
export const CARD_SCENARIOS = ['succeeded', 'declined', 'requires_action', 'processing'] as const;
export type CardScenario = (typeof CARD_SCENARIOS)[number];

export const EVENT_TYPES = [
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'payment_method.attached',
  'payment_method.detached',
  'payment_intent.created',
  'payment_intent.processing',
  'payment_intent.requires_action',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',
  'refund.created',
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const WEBHOOK_ENDPOINT_STATUSES = ['enabled', 'disabled'] as const;
export type WebhookEndpointStatus = (typeof WEBHOOK_ENDPOINT_STATUSES)[number];

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export const API_KEY_TYPES = ['secret', 'publishable'] as const;
export type ApiKeyType = (typeof API_KEY_TYPES)[number];

export const ERROR_TYPES = [
  'api_error',
  'card_error',
  'idempotency_error',
  'invalid_request_error',
  'authentication_error',
  'rate_limit_error',
] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

export const ERROR_CODES = [
  'api_key_invalid',
  'api_key_required',
  'permission_denied',
  'parameter_invalid',
  'parameter_missing',
  'parameter_unknown',
  'resource_missing',
  'resource_already_exists',
  'url_invalid',
  'payment_intent_unexpected_state',
  'payment_intent_authentication_failure',
  'payment_method_unexpected_state',
  'checkout_session_unexpected_state',
  'charge_already_refunded',
  'amount_too_large',
  'amount_too_small',
  'card_declined',
  'expired_card',
  'incorrect_cvc',
  'incorrect_number',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'processing_error',
  'idempotency_key_in_use',
  'idempotency_key_reused',
  'rate_limit',
  'body_too_large',
  'malformed_request',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const LIVEMODE = false as const;
export const API_VERSION = 'localstripe-v1';
