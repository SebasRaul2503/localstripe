import type {
  CancellationReason,
  CheckoutSessionStatus,
  PaymentIntentStatus,
  RefundReason,
  WebhookDeliveryStatus,
} from '@localstripe/contracts';
import type { ListParams } from '../pagination.js';

export type { ListParams };

export type Metadata = Record<string, string>;

export interface RangeQuery {
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

export interface AddressParam {
  city?: string | null;
  country?: string | null;
  line1?: string | null;
  line2?: string | null;
  postal_code?: string | null;
  state?: string | null;
}

export interface CustomerCreateParams {
  email?: string;
  name?: string | null;
  phone?: string | null;
  description?: string | null;
  address?: AddressParam | '';
  metadata?: Metadata;
}

export interface CustomerUpdateParams extends CustomerCreateParams {
  invoice_settings?: { default_payment_method?: string | null };
}

export interface CustomerListParams extends ListParams {
  email?: string;
  /** LocalStripe extension: matches id, email or name. */
  query?: string;
}

export interface CustomerPaymentMethodListParams extends ListParams {
  type?: string;
}

export interface CardParam {
  number: string;
  exp_month: number;
  exp_year: number;
  cvc?: string;
}

export interface BillingDetailsParam {
  name?: string | null;
  email?: string;
  phone?: string | null;
  address?: AddressParam | '';
}

export interface PaymentMethodCreateParams {
  type: 'card';
  card: CardParam;
  billing_details?: BillingDetailsParam;
  metadata?: Metadata;
}

export interface PaymentMethodUpdateParams {
  billing_details?: BillingDetailsParam;
  metadata?: Metadata;
  card?: { exp_month?: number; exp_year?: number };
}

export interface PaymentMethodListParams extends ListParams {
  customer?: string;
  type?: string;
}

export interface PaymentIntentCreateParams {
  amount: number;
  currency: string;
  customer?: string;
  /** A payment method id or a test token such as `pm_card_visa`. */
  payment_method?: string;
  description?: string | null;
  receipt_email?: string;
  metadata?: Metadata;
  confirm?: boolean;
  return_url?: string;
  capture_method?: 'automatic';
  confirmation_method?: 'automatic';
  payment_method_types?: 'card'[];
}

export interface PaymentIntentUpdateParams {
  amount?: number;
  currency?: string;
  customer?: string | null;
  payment_method?: string;
  description?: string | null;
  receipt_email?: string;
  metadata?: Metadata;
  payment_method_types?: 'card'[];
}

export interface PaymentIntentConfirmParams {
  payment_method?: string;
  return_url?: string;
  client_secret?: string;
}

export interface PaymentIntentCancelParams {
  cancellation_reason?: CancellationReason;
}

export interface PaymentIntentListParams extends ListParams {
  customer?: string;
  /** LocalStripe extension. */
  status?: PaymentIntentStatus;
}

export interface ChargeListParams extends ListParams {
  payment_intent?: string;
  customer?: string;
}

export interface RefundCreateParams {
  payment_intent?: string;
  charge?: string;
  amount?: number;
  reason?: RefundReason;
  metadata?: Metadata;
}

export interface RefundUpdateParams {
  metadata?: Metadata;
}

export interface RefundListParams extends ListParams {
  payment_intent?: string;
  charge?: string;
}

export interface CheckoutLineItemParam {
  price_data: {
    currency: string;
    unit_amount: number;
    product_data: { name: string; description?: string };
  };
  quantity: number;
}

export interface CheckoutSessionCreateParams {
  mode?: 'payment';
  line_items: CheckoutLineItemParam[];
  success_url: string;
  cancel_url?: string;
  customer?: string;
  customer_email?: string;
  client_reference_id?: string;
  metadata?: Metadata;
  expires_at?: number;
  payment_method_types?: 'card'[];
}

export interface CheckoutSessionListParams extends ListParams {
  payment_intent?: string;
  customer?: string;
  status?: CheckoutSessionStatus;
}

export interface EventListParams extends ListParams {
  type?: string;
  types?: string[];
  created?: number | RangeQuery;
  /** LocalStripe extension: events of a single object. */
  object_id?: string;
}

export interface WebhookEndpointCreateParams {
  url: string;
  /** Event types, or `['*']` for every event. */
  enabled_events: string[];
  description?: string | null;
  metadata?: Metadata;
}

export interface WebhookEndpointUpdateParams {
  url?: string;
  enabled_events?: string[];
  description?: string | null;
  disabled?: boolean;
  metadata?: Metadata;
}

export interface WebhookDeliveryListParams extends ListParams {
  webhook_endpoint?: string;
  event?: string;
  status?: WebhookDeliveryStatus;
}
