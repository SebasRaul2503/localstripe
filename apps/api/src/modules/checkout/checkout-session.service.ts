import type {
  CheckoutPaymentStatus,
  CheckoutSession,
  CheckoutSessionStatus,
  LineItem,
  List,
  PaymentIntent,
  PaymentIntentStatus,
} from '@localstripe/contracts';
import {
  type Db,
  type Executor,
  json,
  type StoredLineItem,
  type Tx,
} from '../../infrastructure/database.js';
import type { EventService } from '../events/event.service.js';
import type { CustomerService } from '../customers/customer.service.js';
import type { PaymentMethodService } from '../payment-methods/payment-method.service.js';
import type {
  PaymentContext,
  PaymentIntentListener,
  PaymentIntentRow,
  PaymentIntentService,
} from '../payment-intents/payment-intent.service.js';
import type { CardInput } from '../payment-methods/card-validation.js';
import { newId } from '../../shared/ids.js';
import { invalidRequest, notFound, unexpectedState } from '../../shared/errors.js';
import type { Origin } from '../../shared/context.js';
import { paginate, type PageRequest } from '../../shared/pagination.js';
import { createMetadata, type MetadataInput } from '../../shared/validation.js';
import { toUnix } from '../../shared/time.js';

export interface LineItemInput {
  price_data: {
    currency: string;
    unit_amount: number;
    product_data: { name: string; description?: string | null };
  };
  quantity: number;
}

export interface CreateCheckoutSessionInput {
  mode?: 'payment';
  line_items: LineItemInput[];
  success_url: string;
  cancel_url?: string;
  customer?: string;
  customer_email?: string | null;
  client_reference_id?: string;
  metadata?: MetadataInput;
  expires_at?: number;
}

export interface CompleteCheckoutInput {
  payment_method?: string;
  card?: CardInput;
}

export interface CheckoutSessionRow {
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
  lineItems: StoredLineItem[];
  metadata: Record<string, string>;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}

const MIN_EXPIRY_SECONDS = 30 * 60;
const MAX_EXPIRY_SECONDS = 24 * 60 * 60;

export class CheckoutSessionService implements PaymentIntentListener {
  constructor(
    private readonly db: Db,
    private readonly events: EventService,
    private readonly customers: CustomerService,
    private readonly paymentMethods: PaymentMethodService,
    private readonly paymentIntents: PaymentIntentService,
    private readonly settings: { publicUrl: string; sessionTtlMinutes: number },
  ) {
    paymentIntents.addListener(this);
  }

  hostedUrl(id: string): string {
    return new URL(`/checkout/${id}`, this.settings.publicUrl).toString();
  }

  toResource(row: CheckoutSessionRow): CheckoutSession {
    return {
      id: row.id,
      object: 'checkout.session',
      amount_subtotal: row.amountSubtotal,
      amount_total: row.amountTotal,
      cancel_url: row.cancelUrl,
      client_reference_id: row.clientReferenceId,
      created: toUnix(row.createdAt),
      currency: row.currency,
      customer: row.customerId,
      customer_email: row.customerEmail,
      expires_at: toUnix(row.expiresAt),
      livemode: false,
      metadata: row.metadata,
      mode: 'payment',
      payment_intent: row.paymentIntentId,
      payment_status: row.paymentStatus as CheckoutPaymentStatus,
      status: row.status as CheckoutSessionStatus,
      success_url: row.successUrl,
      url: row.status === 'open' ? this.hostedUrl(row.id) : null,
    };
  }

  async create(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const currencies = new Set(input.line_items.map((item) => item.price_data.currency));
    if (currencies.size !== 1) {
      throw invalidRequest('All line items must use the same currency.', { param: 'line_items' });
    }
    const lineItems: StoredLineItem[] = input.line_items.map((item) => ({
      id: newId('lineItem'),
      name: item.price_data.product_data.name,
      description: item.price_data.product_data.description ?? null,
      unitAmount: item.price_data.unit_amount,
      quantity: item.quantity,
    }));
    const total = lineItems.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
    if (total > 99_999_999) {
      throw invalidRequest('The total amount of the session is too large.', {
        code: 'amount_too_large',
        param: 'line_items',
      });
    }

    const now = Math.floor(Date.now() / 1000);
    let expiresAt = now + this.settings.sessionTtlMinutes * 60;
    if (input.expires_at !== undefined) {
      const inSeconds = input.expires_at - now;
      if (inSeconds < MIN_EXPIRY_SECONDS || inSeconds > MAX_EXPIRY_SECONDS) {
        throw invalidRequest('expires_at must be between 30 minutes and 24 hours from now.', {
          param: 'expires_at',
        });
      }
      expiresAt = input.expires_at;
    }

    return this.db.transaction().execute(async (tx) => {
      if (input.customer) await this.customers.requireActive(tx, input.customer);
      const row = await tx
        .insertInto('checkoutSessions')
        .values({
          id: newId('checkoutSession'),
          status: 'open',
          paymentStatus: 'unpaid',
          currency: [...currencies][0]!,
          amountSubtotal: total,
          amountTotal: total,
          customerId: input.customer ?? null,
          customerEmail: input.customer_email ?? null,
          clientReferenceId: input.client_reference_id ?? null,
          successUrl: input.success_url,
          cancelUrl: input.cancel_url ?? null,
          lineItems: json(lineItems),
          metadata: json(createMetadata(input.metadata)),
          expiresAt: new Date(expiresAt * 1000),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return this.toResource(row);
    });
  }

  async requireRow(executor: Executor, id: string): Promise<CheckoutSessionRow> {
    const row = await executor
      .selectFrom('checkoutSessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound('checkout.session', id);
    return row;
  }

  async retrieve(id: string): Promise<CheckoutSession> {
    return this.toResource(await this.requireRow(this.db, id));
  }

  async listLineItems(id: string): Promise<List<LineItem>> {
    const row = await this.requireRow(this.db, id);
    return {
      object: 'list',
      data: row.lineItems.map((item) => ({
        id: item.id,
        object: 'item',
        amount_subtotal: item.unitAmount * item.quantity,
        amount_total: item.unitAmount * item.quantity,
        currency: row.currency,
        description: item.name,
        quantity: item.quantity,
        price: {
          object: 'price',
          currency: row.currency,
          unit_amount: item.unitAmount,
          product_data: { name: item.name, description: item.description },
        },
      })),
      has_more: false,
      url: `/v1/checkout/sessions/${id}/line_items`,
    };
  }

  async list(
    filters: { paymentIntent?: string; customer?: string; status?: CheckoutSessionStatus },
    page: PageRequest,
  ): Promise<List<CheckoutSession>> {
    return paginate(
      '/v1/checkout/sessions',
      page,
      ({ cursor, order, take }) => {
        let query = this.db.selectFrom('checkoutSessions').selectAll();
        if (filters.paymentIntent)
          query = query.where('paymentIntentId', '=', filters.paymentIntent);
        if (filters.customer) query = query.where('customerId', '=', filters.customer);
        if (filters.status) query = query.where('status', '=', filters.status);
        if (cursor) query = query.where('id', cursor.op, cursor.id);
        return query.orderBy('id', order).limit(take).execute();
      },
      (row) => this.toResource(row),
    );
  }

  async expire(id: string, origin: Origin): Promise<CheckoutSession> {
    const session = await this.db.transaction().execute(async (tx) => {
      const row = await this.lock(tx, id);
      if (row.status !== 'open') {
        throw unexpectedState(
          'checkout_session_unexpected_state',
          `Only open Checkout Sessions can be expired. This session is ${row.status}.`,
        );
      }
      return this.markExpired(tx, row, origin);
    });
    await this.cancelAbandonedPayment(session, origin);
    return this.toResource(session);
  }

  /** Expires every open session past its `expires_at`. Called periodically by the worker. */
  async expireDue(origin: Origin): Promise<number> {
    const due = await this.db
      .selectFrom('checkoutSessions')
      .select('id')
      .where('status', '=', 'open')
      .where('expiresAt', '<=', new Date())
      .limit(100)
      .execute();
    let expired = 0;
    for (const { id } of due) {
      const session = await this.db.transaction().execute(async (tx) => {
        const row = await this.lock(tx, id);
        return row.status === 'open' ? this.markExpired(tx, row, origin) : null;
      });
      if (session) {
        expired += 1;
        await this.cancelAbandonedPayment(session, origin);
      }
    }
    return expired;
  }

  private async markExpired(
    tx: Tx,
    row: CheckoutSessionRow,
    origin: Origin,
  ): Promise<CheckoutSessionRow> {
    const updated = await tx
      .updateTable('checkoutSessions')
      .set({ status: 'expired' })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.events.emit(
      tx,
      { type: 'checkout.session.expired', object: this.toResource(updated) },
      origin,
    );
    return updated;
  }

  private async cancelAbandonedPayment(session: CheckoutSessionRow, origin: Origin) {
    if (!session.paymentIntentId) return;
    const paymentIntent = await this.paymentIntents.requireRow(this.db, session.paymentIntentId);
    if (
      ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(
        paymentIntent.status,
      )
    ) {
      await this.paymentIntents.cancel(paymentIntent.id, 'abandoned', origin);
    }
  }

  private async lock(tx: Tx, id: string): Promise<CheckoutSessionRow> {
    const row = await tx
      .selectFrom('checkoutSessions')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound('checkout.session', id);
    return row;
  }

  /**
   * Pays an open session, as the hosted checkout page does. Reuses the session's PaymentIntent
   * after a failed attempt, like Stripe Checkout. Card declines surface as 402 card errors.
   */
  async complete(
    id: string,
    input: CompleteCheckoutInput,
    ctx: PaymentContext,
  ): Promise<{ session: CheckoutSession; paymentIntent: PaymentIntent }> {
    const expiredNow = await this.expireIfDue(id, ctx);
    const session = expiredNow ?? (await this.requireRow(this.db, id));
    if (session.status !== 'open') {
      throw unexpectedState(
        'checkout_session_unexpected_state',
        `This Checkout Session is ${session.status} and can no longer be paid.`,
      );
    }
    if (!input.card && !input.payment_method) {
      throw invalidRequest('Provide either card details or a payment_method.', {
        code: 'parameter_missing',
        param: 'payment_method',
      });
    }
    const paymentMethodId = input.card
      ? (await this.paymentMethods.create({ type: 'card', card: input.card })).id
      : input.payment_method!;

    let paymentIntentId = session.paymentIntentId;
    if (paymentIntentId) {
      const existing = await this.paymentIntents.requireRow(this.db, paymentIntentId);
      if (existing.status !== 'requires_payment_method') {
        throw unexpectedState(
          'checkout_session_unexpected_state',
          `The payment for this session is ${existing.status}; it cannot be retried.`,
        );
      }
    } else {
      const created = await this.paymentIntents.create(
        {
          amount: session.amountTotal,
          currency: session.currency,
          customer: session.customerId ?? undefined,
          receipt_email: session.customerEmail,
          metadata: session.metadata,
        },
        ctx,
        { checkoutSessionId: session.id },
      );
      paymentIntentId = created.id;
      await this.db
        .updateTable('checkoutSessions')
        .set({ paymentIntentId })
        .where('id', '=', session.id)
        .execute();
    }

    const paymentIntent = await this.paymentIntents.confirm(
      paymentIntentId,
      { payment_method: paymentMethodId, return_url: this.hostedUrl(session.id) },
      ctx,
    );
    return { session: await this.retrieve(id), paymentIntent };
  }

  private async expireIfDue(id: string, origin: Origin): Promise<CheckoutSessionRow | null> {
    const row = await this.requireRow(this.db, id);
    if (row.status !== 'open' || row.expiresAt > new Date()) return null;
    return this.db.transaction().execute(async (tx) => {
      const locked = await this.lock(tx, id);
      return locked.status === 'open' ? this.markExpired(tx, locked, origin) : locked;
    });
  }

  async onStatusChanged(
    tx: Tx,
    paymentIntent: PaymentIntentRow,
    previousStatus: PaymentIntentStatus,
    origin: Origin,
  ): Promise<void> {
    if (!paymentIntent.checkoutSessionId) return;
    const session = await this.lock(tx, paymentIntent.checkoutSessionId);

    const update = async (
      changes: { status?: string; paymentStatus?: string; completedAt?: Date },
      eventType: 'checkout.session.completed' | 'checkout.session.async_payment_succeeded',
    ) => {
      const updated = await tx
        .updateTable('checkoutSessions')
        .set(changes)
        .where('id', '=', session.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.events.emit(tx, { type: eventType, object: this.toResource(updated) }, origin);
    };

    const awaitingAsyncPayment =
      session.status === 'complete' && session.paymentStatus === 'unpaid';
    switch (paymentIntent.status) {
      case 'succeeded':
        if (session.status === 'open') {
          await update(
            { status: 'complete', paymentStatus: 'paid', completedAt: new Date() },
            'checkout.session.completed',
          );
        } else if (awaitingAsyncPayment) {
          await update({ paymentStatus: 'paid' }, 'checkout.session.async_payment_succeeded');
        }
        break;
      case 'processing':
        if (session.status === 'open') {
          await update(
            { status: 'complete', completedAt: new Date() },
            'checkout.session.completed',
          );
        }
        break;
      case 'requires_payment_method':
        // Stripe keeps a session `complete` (and unpaid) when its delayed payment fails.
        if (previousStatus === 'processing' && awaitingAsyncPayment) {
          await this.events.emit(
            tx,
            { type: 'checkout.session.async_payment_failed', object: this.toResource(session) },
            origin,
          );
        }
        break;
    }
  }
}
