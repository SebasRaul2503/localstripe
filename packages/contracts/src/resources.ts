import { z } from 'zod';
import {
  API_KEY_TYPES,
  CANCELLATION_REASONS,
  CARD_BRANDS,
  CARD_FUNDING,
  CARD_SCENARIOS,
  CHARGE_STATUSES,
  CHECKOUT_PAYMENT_STATUSES,
  CHECKOUT_SESSION_STATUSES,
  ERROR_TYPES,
  PAYMENT_INTENT_STATUSES,
  REFUND_REASONS,
  REFUND_STATUSES,
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_ENDPOINT_STATUSES,
} from './enums.js';

const timestamp = z.number().int().describe('Unix timestamp in seconds.');
const metadata = z.record(z.string(), z.string());
const livemode = z.literal(false);

export const addressSchema = z.object({
  city: z.string().nullable(),
  country: z.string().nullable(),
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  postal_code: z.string().nullable(),
  state: z.string().nullable(),
});
export type Address = z.infer<typeof addressSchema>;

export const customerSchema = z.object({
  id: z.string(),
  object: z.literal('customer'),
  address: addressSchema.nullable(),
  created: timestamp,
  description: z.string().nullable(),
  email: z.string().nullable(),
  invoice_settings: z.object({ default_payment_method: z.string().nullable() }),
  livemode,
  metadata,
  name: z.string().nullable(),
  phone: z.string().nullable(),
});
export type Customer = z.infer<typeof customerSchema>;

export const deletedObjectSchema = z.object({
  id: z.string(),
  object: z.string(),
  deleted: z.literal(true),
});
export type DeletedObject = z.infer<typeof deletedObjectSchema>;

export const billingDetailsSchema = z.object({
  address: addressSchema.nullable(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
});
export type BillingDetails = z.infer<typeof billingDetailsSchema>;

export const paymentMethodSchema = z.object({
  id: z.string(),
  object: z.literal('payment_method'),
  billing_details: billingDetailsSchema,
  card: z.object({
    brand: z.enum(CARD_BRANDS),
    country: z.string().nullable(),
    exp_month: z.number().int(),
    exp_year: z.number().int(),
    fingerprint: z.string(),
    funding: z.enum(CARD_FUNDING),
    last4: z.string(),
  }),
  created: timestamp,
  customer: z.string().nullable(),
  livemode,
  metadata,
  type: z.literal('card'),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentErrorSchema = z.object({
  type: z.enum(ERROR_TYPES),
  code: z.string().nullable(),
  decline_code: z.string().nullable(),
  message: z.string(),
  payment_method: paymentMethodSchema.nullable(),
});
export type PaymentError = z.infer<typeof paymentErrorSchema>;

export const nextActionSchema = z.object({
  type: z.literal('redirect_to_url'),
  redirect_to_url: z.object({
    return_url: z.string().nullable(),
    url: z.string(),
  }),
});
export type NextAction = z.infer<typeof nextActionSchema>;

export const paymentIntentSchema = z.object({
  id: z.string(),
  object: z.literal('payment_intent'),
  amount: z.number().int(),
  amount_received: z.number().int(),
  canceled_at: timestamp.nullable(),
  cancellation_reason: z.enum(CANCELLATION_REASONS).nullable(),
  capture_method: z.literal('automatic'),
  client_secret: z.string(),
  confirmation_method: z.literal('automatic'),
  created: timestamp,
  currency: z.string(),
  customer: z.string().nullable(),
  description: z.string().nullable(),
  last_payment_error: paymentErrorSchema.nullable(),
  latest_charge: z.string().nullable(),
  livemode,
  metadata,
  next_action: nextActionSchema.nullable(),
  payment_method: z.string().nullable(),
  payment_method_types: z.array(z.string()),
  receipt_email: z.string().nullable(),
  status: z.enum(PAYMENT_INTENT_STATUSES),
});
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

export const chargeSchema = z.object({
  id: z.string(),
  object: z.literal('charge'),
  amount: z.number().int(),
  amount_captured: z.number().int(),
  amount_refunded: z.number().int(),
  captured: z.boolean(),
  created: timestamp,
  currency: z.string(),
  customer: z.string().nullable(),
  description: z.string().nullable(),
  failure_code: z.string().nullable(),
  failure_message: z.string().nullable(),
  livemode,
  metadata,
  outcome: z.object({
    network_status: z.string(),
    reason: z.string().nullable(),
    seller_message: z.string(),
    type: z.string(),
  }),
  paid: z.boolean(),
  payment_intent: z.string().nullable(),
  payment_method: z.string().nullable(),
  payment_method_details: z.object({
    type: z.literal('card'),
    card: z.object({
      brand: z.enum(CARD_BRANDS),
      last4: z.string(),
      exp_month: z.number().int(),
      exp_year: z.number().int(),
    }),
  }),
  refunded: z.boolean(),
  status: z.enum(CHARGE_STATUSES),
});
export type Charge = z.infer<typeof chargeSchema>;

export const refundSchema = z.object({
  id: z.string(),
  object: z.literal('refund'),
  amount: z.number().int(),
  charge: z.string(),
  created: timestamp,
  currency: z.string(),
  livemode,
  metadata,
  payment_intent: z.string(),
  reason: z.enum(REFUND_REASONS).nullable(),
  status: z.enum(REFUND_STATUSES),
});
export type Refund = z.infer<typeof refundSchema>;

export const lineItemSchema = z.object({
  id: z.string(),
  object: z.literal('item'),
  amount_subtotal: z.number().int(),
  amount_total: z.number().int(),
  currency: z.string(),
  description: z.string(),
  quantity: z.number().int(),
  price: z.object({
    object: z.literal('price'),
    currency: z.string(),
    unit_amount: z.number().int(),
    product_data: z.object({ name: z.string(), description: z.string().nullable() }),
  }),
});
export type LineItem = z.infer<typeof lineItemSchema>;

export const checkoutSessionSchema = z.object({
  id: z.string(),
  object: z.literal('checkout.session'),
  amount_subtotal: z.number().int(),
  amount_total: z.number().int(),
  cancel_url: z.string().nullable(),
  client_reference_id: z.string().nullable(),
  created: timestamp,
  currency: z.string(),
  customer: z.string().nullable(),
  customer_email: z.string().nullable(),
  expires_at: timestamp,
  livemode,
  metadata,
  mode: z.literal('payment'),
  payment_intent: z.string().nullable(),
  payment_status: z.enum(CHECKOUT_PAYMENT_STATUSES),
  status: z.enum(CHECKOUT_SESSION_STATUSES),
  success_url: z.string(),
  url: z.string().nullable(),
});
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>;

export const eventSchema = z.object({
  id: z.string(),
  object: z.literal('event'),
  api_version: z.string(),
  created: timestamp,
  data: z.object({
    object: z.record(z.string(), z.unknown()),
    previous_attributes: z.record(z.string(), z.unknown()).optional(),
  }),
  livemode,
  pending_webhooks: z.number().int(),
  request: z.object({
    id: z.string().nullable(),
    idempotency_key: z.string().nullable(),
  }),
  type: z.string(),
});
export type LocalStripeEvent = z.infer<typeof eventSchema>;

export const webhookEndpointSchema = z.object({
  id: z.string(),
  object: z.literal('webhook_endpoint'),
  created: timestamp,
  description: z.string().nullable(),
  enabled_events: z.array(z.string()),
  livemode,
  metadata,
  secret: z
    .string()
    .optional()
    .describe(
      'Only returned when the endpoint is created (or via the LocalStripe reveal endpoint).',
    ),
  status: z.enum(WEBHOOK_ENDPOINT_STATUSES),
  url: z.string(),
});
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

export const webhookDeliverySchema = z.object({
  id: z.string(),
  object: z.literal('webhook_delivery'),
  attempts: z.number().int(),
  created: timestamp,
  event: z.string(),
  event_type: z.string(),
  last_attempt_at: timestamp.nullable(),
  last_error: z.string().nullable(),
  last_response_status: z.number().int().nullable(),
  next_attempt_at: timestamp.nullable(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES),
  url: z.string(),
  webhook_endpoint: z.string(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const webhookDeliveryAttemptSchema = z.object({
  id: z.string(),
  object: z.literal('webhook_delivery_attempt'),
  attempt: z.number().int(),
  created: timestamp,
  duration_ms: z.number().int(),
  error: z.string().nullable(),
  response_body: z.string().nullable(),
  response_status: z.number().int().nullable(),
  succeeded: z.boolean(),
});
export type WebhookDeliveryAttempt = z.infer<typeof webhookDeliveryAttemptSchema>;

export const apiKeySchema = z.object({
  id: z.string(),
  object: z.literal('api_key'),
  created: timestamp,
  last_used_at: timestamp.nullable(),
  livemode,
  name: z.string(),
  redacted_key: z.string(),
  revoked: z.boolean(),
  secret: z
    .string()
    .optional()
    .describe('The full key. Only returned once, when the key is created.'),
  type: z.enum(API_KEY_TYPES),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const testCardSchema = z.object({
  object: z.literal('test_card'),
  id: z.string(),
  number: z.string(),
  brand: z.enum(CARD_BRANDS),
  funding: z.enum(CARD_FUNDING),
  label: z.string(),
  scenario: z.enum(CARD_SCENARIOS),
  decline_code: z.string().nullable(),
  error_code: z.string().nullable(),
  settles_to: z.enum(['succeeded', 'declined']).nullable(),
  delay_ms: z.number().int().nullable(),
  payment_method_token: z.string().nullable(),
  description: z.string(),
});
export type TestCard = z.infer<typeof testCardSchema>;

export const statsSchema = z.object({
  object: z.literal('stats'),
  payment_intents: z.object({
    total: z.number().int(),
    by_status: z.record(z.string(), z.number().int()),
    failed: z.number().int(),
  }),
  volume: z.array(
    z.object({
      currency: z.string(),
      succeeded_amount: z.number().int(),
      refunded_amount: z.number().int(),
    }),
  ),
  customers: z.number().int(),
  refunds: z.number().int(),
  events: z.number().int(),
  webhook_deliveries: z.object({
    pending: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
  }),
});
export type Stats = z.infer<typeof statsSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    type: z.enum(ERROR_TYPES),
    code: z.string().optional(),
    decline_code: z.string().optional(),
    message: z.string(),
    param: z.string().optional(),
    payment_intent: paymentIntentSchema.optional(),
    request_log_url: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function listSchema<T extends z.ZodType>(item: T) {
  return z.object({
    object: z.literal('list'),
    data: z.array(item),
    has_more: z.boolean(),
    url: z.string(),
  });
}

export interface List<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}
