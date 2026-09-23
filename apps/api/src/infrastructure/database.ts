import pg from 'pg';
import {
  CamelCasePlugin,
  type ColumnType,
  type Generated,
  Kysely,
  PostgresDialect,
  type Transaction,
} from 'kysely';
import type { Address, BillingDetails, PaymentError, NextAction } from '@localstripe/contracts';

// Amounts and counts are well inside Number.MAX_SAFE_INTEGER, so int8 can be parsed as a number.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

/** jsonb columns are written as JSON strings so arrays are never coerced into Postgres arrays. */
type Json<T> = ColumnType<T, string, string>;
type CreatedAt = ColumnType<Date, Date | undefined, never>;
export type Metadata = Record<string, string>;

export interface ApiKeysTable {
  id: string;
  type: 'secret' | 'publishable';
  name: string;
  keyHash: string;
  keyPrefix: string;
  keyLast4: string;
  publishablePlaintext: string | null;
  internal: Generated<boolean>;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: CreatedAt;
}

export interface CustomersTable {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  description: string | null;
  address: Json<Address | null> | null;
  defaultPaymentMethod: string | null;
  metadata: Json<Metadata>;
  deletedAt: Date | null;
  createdAt: CreatedAt;
  updatedAt: ColumnType<Date, Date | undefined, Date>;
}

export interface PaymentMethodsTable {
  id: string;
  customerId: string | null;
  testCardId: string;
  brand: string;
  funding: string;
  last4: string;
  expMonth: number;
  expYear: number;
  fingerprint: string;
  billingDetails: Json<BillingDetails>;
  metadata: Json<Metadata>;
  createdAt: CreatedAt;
}

export interface PaymentIntentsTable {
  id: string;
  amount: number;
  amountReceived: Generated<number>;
  currency: string;
  status: string;
  customerId: string | null;
  paymentMethodId: string | null;
  clientSecret: string;
  description: string | null;
  receiptEmail: string | null;
  returnUrl: string | null;
  lastPaymentError: Json<PaymentError | null> | null;
  nextAction: Json<NextAction | null> | null;
  latestChargeId: string | null;
  cancellationReason: string | null;
  canceledAt: Date | null;
  checkoutSessionId: string | null;
  metadata: Json<Metadata>;
  createdAt: CreatedAt;
  updatedAt: ColumnType<Date, Date | undefined, Date>;
}

export interface ChargesTable {
  id: string;
  paymentIntentId: string;
  paymentMethodId: string;
  customerId: string | null;
  amount: number;
  amountRefunded: Generated<number>;
  currency: string;
  status: 'succeeded' | 'pending' | 'failed';
  failureCode: string | null;
  failureMessage: string | null;
  declineCode: string | null;
  description: string | null;
  metadata: Json<Metadata>;
  createdAt: CreatedAt;
}

export interface RefundsTable {
  id: string;
  chargeId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  reason: string | null;
  status: string;
  metadata: Json<Metadata>;
  createdAt: CreatedAt;
}

export interface StoredLineItem {
  id: string;
  name: string;
  description: string | null;
  unitAmount: number;
  quantity: number;
}

export interface CheckoutSessionsTable {
  id: string;
  status: string;
  paymentStatus: string;
  currency: string;
  amountSubtotal: number;
  amountTotal: number;
  customerId: string | null;
  customerEmail: string | null;
  clientReferenceId: string | null;
  paymentIntentId: string | null;
  successUrl: string;
  cancelUrl: string | null;
  lineItems: Json<StoredLineItem[]>;
  metadata: Json<Metadata>;
  paymentIntentMetadata: Json<Metadata> | null;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: CreatedAt;
}

export interface EventsTable {
  id: string;
  type: string;
  objectId: string;
  data: Json<{ object: Record<string, unknown>; previous_attributes?: Record<string, unknown> }>;
  requestId: string | null;
  idempotencyKey: string | null;
  createdAt: CreatedAt;
}

export interface WebhookEndpointsTable {
  id: string;
  url: string;
  description: string | null;
  enabledEvents: string[];
  secret: string;
  status: 'enabled' | 'disabled';
  metadata: Json<Metadata>;
  deletedAt: Date | null;
  createdAt: CreatedAt;
}

export interface WebhookDeliveriesTable {
  id: string;
  eventId: string;
  webhookEndpointId: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: Generated<number>;
  nextAttemptAt: Date | null;
  lockedUntil: Date | null;
  lastAttemptAt: Date | null;
  lastResponseStatus: number | null;
  lastError: string | null;
  createdAt: CreatedAt;
}

export interface WebhookDeliveryAttemptsTable {
  id: string;
  webhookDeliveryId: string;
  attempt: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
  succeeded: boolean;
  createdAt: CreatedAt;
}

export interface IdempotencyKeysTable {
  id: Generated<number>;
  apiKeyId: string;
  key: string;
  requestMethod: string;
  requestPath: string;
  requestHash: string;
  status: 'in_progress' | 'completed';
  responseStatus: number | null;
  responseBody: Json<unknown> | null;
  lockedAt: ColumnType<Date, Date | undefined, Date>;
  createdAt: CreatedAt;
}

export interface JobsTable {
  id: string;
  type: string;
  payload: Json<Record<string, unknown>>;
  runAt: Date;
  attempts: Generated<number>;
  lockedUntil: Date | null;
  lastError: string | null;
  createdAt: CreatedAt;
}

export interface Database {
  apiKeys: ApiKeysTable;
  customers: CustomersTable;
  paymentMethods: PaymentMethodsTable;
  paymentIntents: PaymentIntentsTable;
  charges: ChargesTable;
  refunds: RefundsTable;
  checkoutSessions: CheckoutSessionsTable;
  events: EventsTable;
  webhookEndpoints: WebhookEndpointsTable;
  webhookDeliveries: WebhookDeliveriesTable;
  webhookDeliveryAttempts: WebhookDeliveryAttemptsTable;
  idempotencyKeys: IdempotencyKeysTable;
  jobs: JobsTable;
}

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;
/** Anything that can run queries: the pool or an open transaction. */
export type Executor = Db | Tx;

export const json = (value: unknown): string => JSON.stringify(value);

export function createDatabase(url: string, poolMax: number): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: url, max: poolMax }),
    }),
    // Nested keys must be preserved: jsonb columns hold user metadata and Stripe-shaped objects.
    plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  });
}
