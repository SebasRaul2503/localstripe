import type {
  CancellationReason,
  ErrorType,
  List,
  NextAction,
  PaymentError,
  PaymentIntent,
  PaymentIntentStatus,
} from '@localstripe/contracts';
import { type Db, type Executor, json, type Tx } from '../../infrastructure/database.js';
import type { Metrics } from '../../infrastructure/metrics.js';
import type { EventService } from '../events/event.service.js';
import type { CustomerService } from '../customers/customer.service.js';
import {
  type PaymentMethodRow,
  type PaymentMethodService,
  toPaymentMethodResource,
} from '../payment-methods/payment-method.service.js';
import { type ChargeService, toChargeResource } from '../charges/charge.service.js';
import { type DelaySettings, resolveDelayMs } from '../test-cards/catalog.js';
import type { JobQueue } from '../../worker/job-queue.js';
import { newId, randomToken } from '../../shared/ids.js';
import {
  cardError,
  forbidden,
  invalidRequest,
  notFound,
  unexpectedState,
} from '../../shared/errors.js';
import type { Origin } from '../../shared/context.js';
import { paginate, type PageRequest } from '../../shared/pagination.js';
import { applyMetadata, createMetadata, type MetadataInput } from '../../shared/validation.js';
import { sleep, toUnix, toUnixOrNull } from '../../shared/time.js';
import { assertActionAllowed, assertTransition } from './state-machine.js';
import {
  AUTHENTICATION_FAILURE,
  type ConfirmOutcome,
  type Decline,
  decideConfirmOutcome,
  decideSettlementOutcome,
} from './outcome.js';

export interface PaymentIntentRow {
  id: string;
  amount: number;
  amountReceived: number;
  currency: string;
  status: string;
  customerId: string | null;
  paymentMethodId: string | null;
  clientSecret: string;
  description: string | null;
  receiptEmail: string | null;
  returnUrl: string | null;
  lastPaymentError: PaymentError | null;
  nextAction: NextAction | null;
  latestChargeId: string | null;
  cancellationReason: string | null;
  canceledAt: Date | null;
  checkoutSessionId: string | null;
  metadata: Record<string, string>;
  createdAt: Date;
}

/** Lets other modules (checkout sessions) react to lifecycle changes inside the same transaction. */
export interface PaymentIntentListener {
  onStatusChanged(
    tx: Tx,
    paymentIntent: PaymentIntentRow,
    previousStatus: PaymentIntentStatus,
    origin: Origin,
  ): Promise<void>;
}

export interface CreatePaymentIntentInput {
  amount: number;
  currency: string;
  customer?: string;
  payment_method?: string;
  description?: string | null;
  receipt_email?: string | null;
  metadata?: MetadataInput;
  confirm?: boolean;
  return_url?: string;
}

export interface ConfirmPaymentIntentInput {
  payment_method?: string;
  return_url?: string;
}

export interface UpdatePaymentIntentInput {
  amount?: number;
  currency?: string;
  customer?: string | null;
  payment_method?: string;
  description?: string | null;
  receipt_email?: string | null;
  metadata?: MetadataInput;
}

export interface PaymentContext extends Origin {
  delayOverrideMs?: number;
}

export function toPaymentIntentResource(row: PaymentIntentRow): PaymentIntent {
  return {
    id: row.id,
    object: 'payment_intent',
    amount: row.amount,
    amount_received: row.amountReceived,
    canceled_at: toUnixOrNull(row.canceledAt),
    cancellation_reason: row.cancellationReason as CancellationReason | null,
    capture_method: 'automatic',
    client_secret: row.clientSecret,
    confirmation_method: 'automatic',
    created: toUnix(row.createdAt),
    currency: row.currency,
    customer: row.customerId,
    description: row.description,
    last_payment_error: row.lastPaymentError,
    latest_charge: row.latestChargeId,
    livemode: false,
    metadata: row.metadata,
    next_action: row.nextAction,
    payment_method: row.paymentMethodId,
    payment_method_types: ['card'],
    receipt_email: row.receiptEmail,
    status: row.status as PaymentIntentStatus,
  };
}

export class PaymentIntentService {
  private readonly listeners: PaymentIntentListener[] = [];

  constructor(
    private readonly db: Db,
    private readonly events: EventService,
    private readonly customers: CustomerService,
    private readonly paymentMethods: PaymentMethodService,
    private readonly charges: ChargeService,
    private readonly jobs: JobQueue,
    private readonly metrics: Metrics,
    private readonly settings: { publicUrl: string; delays: DelaySettings },
  ) {}

  addListener(listener: PaymentIntentListener): void {
    this.listeners.push(listener);
  }

  async create(
    input: CreatePaymentIntentInput,
    ctx: PaymentContext,
    internal: { checkoutSessionId?: string } = {},
  ): Promise<PaymentIntent> {
    if (input.confirm && !input.payment_method) {
      throw invalidRequest('A payment_method is required when confirm=true.', {
        code: 'parameter_missing',
        param: 'payment_method',
      });
    }
    const created = await this.db
      .transaction()
      .execute((tx) => this.createInTransaction(tx, input, ctx, internal));

    if (input.confirm) return this.confirm(created.id, { return_url: input.return_url }, ctx);
    return created;
  }

  /** Inserts an unconfirmed PaymentIntent, so callers can create it atomically with other rows. */
  async createInTransaction(
    tx: Tx,
    input: Omit<CreatePaymentIntentInput, 'confirm'>,
    origin: Origin,
    internal: { checkoutSessionId?: string } = {},
  ): Promise<PaymentIntent> {
    if (input.customer) await this.customers.requireActive(tx, input.customer);
    const paymentMethod = input.payment_method
      ? await this.paymentMethods.resolveForPayment(tx, input.payment_method)
      : undefined;
    if (paymentMethod) assertUsableBy(paymentMethod, input.customer ?? null);

    const id = newId('paymentIntent');
    const row = await tx
      .insertInto('paymentIntents')
      .values({
        id,
        amount: input.amount,
        currency: input.currency,
        status: paymentMethod ? 'requires_confirmation' : 'requires_payment_method',
        customerId: input.customer ?? null,
        paymentMethodId: paymentMethod?.id ?? null,
        clientSecret: `${id}_secret_${randomToken(24)}`,
        description: input.description ?? null,
        receiptEmail: input.receipt_email ?? null,
        returnUrl: input.return_url ?? null,
        lastPaymentError: null,
        nextAction: null,
        checkoutSessionId: internal.checkoutSessionId ?? null,
        metadata: json(createMetadata(input.metadata)),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const paymentIntent = toPaymentIntentResource(row);
    await this.events.emit(tx, { type: 'payment_intent.created', object: paymentIntent }, origin);
    return paymentIntent;
  }

  async requireRow(executor: Executor, id: string, param = 'id'): Promise<PaymentIntentRow> {
    const row = await executor
      .selectFrom('paymentIntents')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound('payment_intent', id, param);
    return row;
  }

  private async lock(tx: Tx, id: string): Promise<PaymentIntentRow> {
    const row = await tx
      .selectFrom('paymentIntents')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound('payment_intent', id);
    return row;
  }

  async retrieve(id: string, clientSecret?: string): Promise<PaymentIntent> {
    const row = await this.requireRow(this.db, id);
    if (clientSecret !== undefined) assertClientSecret(row, clientSecret);
    return toPaymentIntentResource(row);
  }

  async update(id: string, input: UpdatePaymentIntentInput): Promise<PaymentIntent> {
    return this.db.transaction().execute(async (tx) => {
      const current = await this.lock(tx, id);
      const status = current.status as PaymentIntentStatus;
      const changesPayment =
        input.amount !== undefined ||
        input.currency !== undefined ||
        input.customer !== undefined ||
        input.payment_method !== undefined;
      if (changesPayment) assertActionAllowed(id, status, 'update');

      const customerId = input.customer === undefined ? current.customerId : input.customer;
      if (input.customer) await this.customers.requireActive(tx, input.customer);

      let paymentMethodId = current.paymentMethodId;
      let nextStatus = status;
      if (input.payment_method) {
        const paymentMethod = await this.paymentMethods.resolveForPayment(tx, input.payment_method);
        assertUsableBy(paymentMethod, customerId);
        paymentMethodId = paymentMethod.id;
        if (status === 'requires_payment_method') nextStatus = 'requires_confirmation';
      }

      const row = await tx
        .updateTable('paymentIntents')
        .set({
          ...(input.amount !== undefined && { amount: input.amount }),
          ...(input.currency !== undefined && { currency: input.currency }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.receipt_email !== undefined && { receiptEmail: input.receipt_email }),
          customerId,
          paymentMethodId,
          status: nextStatus,
          metadata: json(applyMetadata(current.metadata, input.metadata)),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toPaymentIntentResource(row);
    });
  }

  /**
   * Confirms a payment. The test card decides the outcome; the artificial delay is awaited
   * without holding a transaction or a row lock, and the state is re-checked afterwards.
   */
  async confirm(
    id: string,
    input: ConfirmPaymentIntentInput,
    ctx: PaymentContext,
    clientSecret?: string,
  ): Promise<PaymentIntent> {
    const current = await this.requireRow(this.db, id);
    if (clientSecret !== undefined) assertClientSecret(current, clientSecret);
    assertActionAllowed(id, current.status as PaymentIntentStatus, 'confirm');

    const paymentMethodParam = input.payment_method ?? current.paymentMethodId;
    if (!paymentMethodParam) {
      throw unexpectedState(
        'payment_intent_unexpected_state',
        "You cannot confirm this PaymentIntent because it's missing a payment method. Update the PaymentIntent with a payment method and then confirm it again.",
        { param: 'payment_method' },
      );
    }
    const paymentMethod = await this.paymentMethods.resolveForPayment(this.db, paymentMethodParam);
    assertUsableBy(paymentMethod, current.customerId);
    const card = this.paymentMethods.catalogCardFor(paymentMethod);
    const outcome = decideConfirmOutcome(card);
    const delayMs = resolveDelayMs(card, this.settings.delays, ctx.delayOverrideMs);

    if (outcome.kind !== 'processing') await sleep(delayMs);

    const paymentIntent = await this.db.transaction().execute(async (tx) => {
      const locked = await this.lock(tx, id);
      assertActionAllowed(id, locked.status as PaymentIntentStatus, 'confirm');
      const returnUrl = input.return_url ?? locked.returnUrl;
      return this.applyConfirmOutcome(
        tx,
        locked,
        paymentMethod,
        outcome,
        { returnUrl, delayMs },
        ctx,
      );
    });
    this.metrics.paymentOutcomes.inc({ outcome: outcome.kind });

    if (outcome.kind === 'declined') {
      throw cardError(outcome.decline.message, {
        code: outcome.decline.code,
        declineCode: outcome.decline.declineCode ?? undefined,
        paymentIntent,
      });
    }
    return paymentIntent;
  }

  private async applyConfirmOutcome(
    tx: Tx,
    row: PaymentIntentRow,
    paymentMethod: PaymentMethodRow,
    outcome: ConfirmOutcome,
    options: { returnUrl: string | null; delayMs: number },
    origin: Origin,
  ): Promise<PaymentIntent> {
    switch (outcome.kind) {
      case 'succeeded':
        return this.succeed(tx, row, paymentMethod, origin);
      case 'declined':
        return this.fail(tx, row, paymentMethod, outcome.decline, 'card_error', true, origin);
      case 'requires_action':
        return this.requireAction(tx, row, paymentMethod, options.returnUrl, origin);
      case 'processing':
        return this.startProcessing(tx, row, paymentMethod, options.delayMs, origin);
    }
  }

  private async transition(
    tx: Tx,
    row: PaymentIntentRow,
    to: PaymentIntentStatus,
    changes: Partial<{
      paymentMethodId: string | null;
      amountReceived: number;
      latestChargeId: string | null;
      lastPaymentError: string | null;
      nextAction: string | null;
      returnUrl: string | null;
      cancellationReason: string | null;
      canceledAt: Date;
    }>,
  ): Promise<PaymentIntentRow> {
    assertTransition(row.id, row.status as PaymentIntentStatus, to);
    return tx
      .updateTable('paymentIntents')
      .set({ ...changes, status: to, updatedAt: new Date() })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private async notify(tx: Tx, row: PaymentIntentRow, previous: string, origin: Origin) {
    for (const listener of this.listeners) {
      await listener.onStatusChanged(tx, row, previous as PaymentIntentStatus, origin);
    }
  }

  private async succeed(
    tx: Tx,
    row: PaymentIntentRow,
    paymentMethod: PaymentMethodRow,
    origin: Origin,
  ): Promise<PaymentIntent> {
    const charge = await this.charges.create(tx, {
      paymentIntentId: row.id,
      paymentMethodId: paymentMethod.id,
      customerId: row.customerId,
      amount: row.amount,
      currency: row.currency,
      description: row.description,
      metadata: row.metadata,
    });
    const updated = await this.transition(tx, row, 'succeeded', {
      paymentMethodId: paymentMethod.id,
      amountReceived: row.amount,
      latestChargeId: charge.id,
      lastPaymentError: null,
      nextAction: null,
    });
    const paymentIntent = toPaymentIntentResource(updated);
    await this.events.emit(
      tx,
      { type: 'charge.succeeded', object: toChargeResource(charge) },
      origin,
    );
    await this.events.emit(tx, { type: 'payment_intent.succeeded', object: paymentIntent }, origin);
    await this.notify(tx, updated, row.status, origin);
    return paymentIntent;
  }

  private async fail(
    tx: Tx,
    row: PaymentIntentRow,
    paymentMethod: PaymentMethodRow,
    decline: Decline,
    errorType: ErrorType,
    createCharge: boolean,
    origin: Origin,
  ): Promise<PaymentIntent> {
    const charge = createCharge
      ? await this.charges.create(tx, {
          paymentIntentId: row.id,
          paymentMethodId: paymentMethod.id,
          customerId: row.customerId,
          amount: row.amount,
          currency: row.currency,
          description: row.description,
          metadata: row.metadata,
          decline,
        })
      : undefined;
    const lastPaymentError: PaymentError = {
      type: errorType,
      code: decline.code,
      decline_code: decline.declineCode,
      message: decline.message,
      payment_method: toPaymentMethodResource(paymentMethod),
    };
    // Like Stripe, a failed attempt detaches the payment method from the PaymentIntent.
    const updated = await this.transition(tx, row, 'requires_payment_method', {
      paymentMethodId: null,
      latestChargeId: charge?.id ?? row.latestChargeId,
      lastPaymentError: json(lastPaymentError),
      nextAction: null,
    });
    const paymentIntent = toPaymentIntentResource(updated);
    if (charge) {
      await this.events.emit(
        tx,
        { type: 'charge.failed', object: toChargeResource(charge) },
        origin,
      );
    }
    await this.events.emit(
      tx,
      { type: 'payment_intent.payment_failed', object: paymentIntent },
      origin,
    );
    await this.notify(tx, updated, row.status, origin);
    return paymentIntent;
  }

  private async requireAction(
    tx: Tx,
    row: PaymentIntentRow,
    paymentMethod: PaymentMethodRow,
    returnUrl: string | null,
    origin: Origin,
  ): Promise<PaymentIntent> {
    const url = new URL(`/3ds/${row.id}`, this.settings.publicUrl);
    url.searchParams.set('client_secret', row.clientSecret);
    const nextAction: NextAction = {
      type: 'redirect_to_url',
      redirect_to_url: { return_url: returnUrl, url: url.toString() },
    };
    const updated = await this.transition(tx, row, 'requires_action', {
      paymentMethodId: paymentMethod.id,
      returnUrl,
      lastPaymentError: null,
      nextAction: json(nextAction),
    });
    const paymentIntent = toPaymentIntentResource(updated);
    await this.events.emit(
      tx,
      { type: 'payment_intent.requires_action', object: paymentIntent },
      origin,
    );
    await this.notify(tx, updated, row.status, origin);
    return paymentIntent;
  }

  private async startProcessing(
    tx: Tx,
    row: PaymentIntentRow,
    paymentMethod: PaymentMethodRow,
    settleAfterMs: number,
    origin: Origin,
  ): Promise<PaymentIntent> {
    const updated = await this.transition(tx, row, 'processing', {
      paymentMethodId: paymentMethod.id,
      lastPaymentError: null,
      nextAction: null,
    });
    await this.jobs.enqueue(
      tx,
      'payment_intent.settle',
      { payment_intent: row.id },
      new Date(Date.now() + settleAfterMs),
    );
    const paymentIntent = toPaymentIntentResource(updated);
    await this.events.emit(
      tx,
      { type: 'payment_intent.processing', object: paymentIntent },
      origin,
    );
    await this.notify(tx, updated, row.status, origin);
    return paymentIntent;
  }

  /** Completes (or fails) the simulated 3D Secure challenge of a `requires_action` payment. */
  async authenticate(
    id: string,
    result: 'succeed' | 'fail',
    origin: Origin,
    clientSecret?: string,
  ): Promise<PaymentIntent> {
    const paymentIntent = await this.db.transaction().execute(async (tx) => {
      const row = await this.lock(tx, id);
      if (clientSecret !== undefined) assertClientSecret(row, clientSecret);
      assertActionAllowed(id, row.status as PaymentIntentStatus, 'authenticate');
      const paymentMethod = await this.paymentMethods.requireRow(
        tx,
        row.paymentMethodId!,
        'payment_method',
      );
      return result === 'succeed'
        ? this.succeed(tx, row, paymentMethod, origin)
        : this.fail(
            tx,
            row,
            paymentMethod,
            AUTHENTICATION_FAILURE,
            'invalid_request_error',
            false,
            origin,
          );
    });
    this.metrics.paymentOutcomes.inc({ outcome: result === 'succeed' ? 'succeeded' : 'declined' });
    return paymentIntent;
  }

  /** Resolves a `processing` payment. Safe to run more than once: it is a no-op once settled. */
  async settle(id: string, origin: Origin): Promise<PaymentIntent | null> {
    return this.db.transaction().execute(async (tx) => {
      const row = await this.lock(tx, id);
      if (row.status !== 'processing') return null;
      const paymentMethod = await this.paymentMethods.requireRow(
        tx,
        row.paymentMethodId!,
        'payment_method',
      );
      const outcome = decideSettlementOutcome(this.paymentMethods.catalogCardFor(paymentMethod));
      this.metrics.paymentOutcomes.inc({ outcome: outcome.kind });
      return outcome.kind === 'succeeded'
        ? this.succeed(tx, row, paymentMethod, origin)
        : this.fail(tx, row, paymentMethod, outcome.decline, 'card_error', true, origin);
    });
  }

  async cancel(
    id: string,
    reason: CancellationReason | undefined,
    origin: Origin,
  ): Promise<PaymentIntent> {
    return this.db.transaction().execute(async (tx) => {
      const row = await this.lock(tx, id);
      assertActionAllowed(id, row.status as PaymentIntentStatus, 'cancel');
      const updated = await this.transition(tx, row, 'canceled', {
        cancellationReason: reason ?? null,
        canceledAt: new Date(),
        nextAction: null,
      });
      const paymentIntent = toPaymentIntentResource(updated);
      await this.events.emit(
        tx,
        { type: 'payment_intent.canceled', object: paymentIntent },
        origin,
      );
      await this.notify(tx, updated, row.status, origin);
      this.metrics.paymentOutcomes.inc({ outcome: 'canceled' });
      return paymentIntent;
    });
  }

  async list(
    filters: { customer?: string; status?: PaymentIntentStatus },
    page: PageRequest,
  ): Promise<List<PaymentIntent>> {
    return paginate(
      '/v1/payment_intents',
      page,
      ({ cursor, order, take }) => {
        let query = this.db.selectFrom('paymentIntents').selectAll();
        if (filters.customer) query = query.where('customerId', '=', filters.customer);
        if (filters.status) query = query.where('status', '=', filters.status);
        if (cursor) query = query.where('id', cursor.op, cursor.id);
        return query.orderBy('id', order).limit(take).execute();
      },
      toPaymentIntentResource,
    );
  }
}

function assertUsableBy(paymentMethod: PaymentMethodRow, customerId: string | null): void {
  if (paymentMethod.customerId && paymentMethod.customerId !== customerId) {
    throw invalidRequest(
      `The provided PaymentMethod (${paymentMethod.id}) is attached to another customer. Pass that customer to use it.`,
      { param: 'payment_method' },
    );
  }
}

function assertClientSecret(row: PaymentIntentRow, clientSecret: string): void {
  if (clientSecret !== row.clientSecret) {
    throw forbidden(
      'The client_secret provided does not match the client_secret associated with the PaymentIntent.',
    );
  }
}
