import { sql } from 'kysely';
import type { Db } from '../../infrastructure/database.js';
import type { CustomerService } from '../customers/customer.service.js';
import type { PaymentMethodService } from '../payment-methods/payment-method.service.js';
import type {
  PaymentIntentService,
  PaymentContext,
} from '../payment-intents/payment-intent.service.js';
import type { RefundService } from '../refunds/refund.service.js';
import type { CheckoutSessionService } from '../checkout/checkout-session.service.js';
import type { TestCardCatalog } from '../test-cards/catalog.js';
import { ApiError, invalidRequest } from '../../shared/errors.js';

export const TRIGGERABLE_EVENTS = [
  'customer.created',
  'payment_intent.created',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.requires_action',
  'payment_intent.processing',
  'payment_intent.canceled',
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',
  'refund.created',
  'checkout.session.completed',
  'checkout.session.expired',
] as const;
export type TriggerableEvent = (typeof TRIGGERABLE_EVENTS)[number];

export const DEMO_METADATA = { localstripe_demo: 'true' };

/**
 * Builds realistic fixture data by running the real flows (like `stripe trigger`), so triggered
 * events and demo data are indistinguishable from what an integration would produce.
 */
export class FixturesService {
  constructor(
    private readonly db: Db,
    private readonly catalog: TestCardCatalog,
    private readonly customers: CustomerService,
    private readonly paymentMethods: PaymentMethodService,
    private readonly paymentIntents: PaymentIntentService,
    private readonly refunds: RefundService,
    private readonly checkout: CheckoutSessionService,
  ) {}

  private async cardPaymentMethod(cardId: string): Promise<string> {
    const card = this.catalog.findById(cardId);
    if (!card) throw invalidRequest(`The test card '${cardId}' is not in the catalog.`);
    const expYear = new Date().getUTCFullYear() + 3;
    const paymentMethod = await this.paymentMethods.create({
      type: 'card',
      card: { number: card.number, exp_month: 12, exp_year: expYear },
    });
    return paymentMethod.id;
  }

  private async pay(
    cardId: string,
    ctx: PaymentContext,
    extra: {
      customer?: string;
      amount?: number;
      currency?: string;
      metadata?: Record<string, string>;
      description?: string;
    } = {},
  ) {
    const paymentMethod = await this.cardPaymentMethod(cardId);
    try {
      return await this.paymentIntents.create(
        {
          amount: extra.amount ?? 1990,
          currency: extra.currency ?? 'usd',
          customer: extra.customer,
          payment_method: paymentMethod,
          description: extra.description ?? 'Triggered by LocalStripe',
          metadata: extra.metadata,
          confirm: true,
        },
        ctx,
      );
    } catch (error) {
      // Declines are an expected outcome here; the failed PaymentIntent is still created.
      if (error instanceof ApiError && error.type === 'card_error' && error.options.paymentIntent) {
        return error.options.paymentIntent;
      }
      throw error;
    }
  }

  async trigger(event: TriggerableEvent, ctx: PaymentContext): Promise<string[]> {
    const fast: PaymentContext = { ...ctx, delayOverrideMs: ctx.delayOverrideMs ?? 0 };
    switch (event) {
      case 'customer.created':
        return [
          (
            await this.customers.create(
              { name: 'Triggered customer', email: 'trigger@example.test' },
              ctx,
            )
          ).id,
        ];
      case 'payment_intent.created':
        return [(await this.paymentIntents.create({ amount: 1990, currency: 'usd' }, ctx)).id];
      case 'payment_intent.succeeded':
      case 'charge.succeeded':
        return [(await this.pay('visa_success', fast)).id];
      case 'payment_intent.payment_failed':
      case 'charge.failed':
        return [(await this.pay('generic_decline', fast)).id];
      case 'payment_intent.requires_action':
        return [(await this.pay('authentication_required', fast)).id];
      case 'payment_intent.processing':
        return [(await this.pay('local_processing', ctx)).id];
      case 'payment_intent.canceled': {
        const paymentIntent = await this.paymentIntents.create(
          { amount: 1990, currency: 'usd' },
          ctx,
        );
        return [
          (await this.paymentIntents.cancel(paymentIntent.id, 'requested_by_customer', ctx)).id,
        ];
      }
      case 'charge.refunded':
      case 'refund.created': {
        const paymentIntent = await this.pay('visa_success', fast);
        const refund = await this.refunds.create({ payment_intent: paymentIntent.id }, ctx);
        return [paymentIntent.id, refund.id];
      }
      case 'checkout.session.completed': {
        const session = await this.checkout.create({
          line_items: [
            {
              price_data: {
                currency: 'usd',
                unit_amount: 2500,
                product_data: { name: 'Triggered item' },
              },
              quantity: 1,
            },
          ],
          success_url: 'http://localhost:3002/checkout/success',
        });
        const card = this.catalog.findById('visa_success')!;
        const result = await this.checkout.complete(
          session.id,
          {
            card: { number: card.number, exp_month: 12, exp_year: new Date().getUTCFullYear() + 3 },
          },
          fast,
        );
        return [result.session.id, result.paymentIntent.id];
      }
      case 'checkout.session.expired': {
        const session = await this.checkout.create({
          line_items: [
            {
              price_data: {
                currency: 'usd',
                unit_amount: 2500,
                product_data: { name: 'Triggered item' },
              },
              quantity: 1,
            },
          ],
          success_url: 'http://localhost:3002/checkout/success',
        });
        return [(await this.checkout.expire(session.id, ctx)).id];
      }
    }
  }

  /** Creates clearly labelled demo data (names start with "[Demo]", metadata localstripe_demo=true). */
  async seedDemoData(ctx: PaymentContext): Promise<{ customers: number; payment_intents: number }> {
    const fast: PaymentContext = { ...ctx, delayOverrideMs: 0 };
    const people = [
      { name: '[Demo] Ada Lovelace', email: 'ada@demo.localstripe.test' },
      { name: '[Demo] Alan Turing', email: 'alan@demo.localstripe.test' },
      { name: '[Demo] Grace Hopper', email: 'grace@demo.localstripe.test' },
    ];
    const customers = [];
    for (const person of people) {
      customers.push(await this.customers.create({ ...person, metadata: DEMO_METADATA }, ctx));
    }
    const plan: Array<{ card: string; amount: number; currency: string }> = [
      { card: 'visa_success', amount: 4990, currency: 'usd' },
      { card: 'mastercard_success', amount: 12900, currency: 'pen' },
      { card: 'generic_decline', amount: 2500, currency: 'usd' },
      { card: 'insufficient_funds', amount: 89900, currency: 'pen' },
      { card: 'authentication_required', amount: 1500, currency: 'eur' },
      { card: 'amex_success', amount: 30000, currency: 'usd' },
      { card: 'visa_success', amount: 10000, currency: 'pen' },
    ];
    let created = 0;
    for (const [index, entry] of plan.entries()) {
      const paymentIntent = await this.pay(entry.card, fast, {
        customer: customers[index % customers.length]!.id,
        amount: entry.amount,
        currency: entry.currency,
        metadata: DEMO_METADATA,
        description: '[Demo] Sample payment',
      });
      created += 1;
      if (index === 1)
        await this.refunds.create(
          { payment_intent: paymentIntent.id, amount: 3000, metadata: DEMO_METADATA },
          ctx,
        );
      if (index === 5)
        await this.refunds.create(
          { payment_intent: paymentIntent.id, metadata: DEMO_METADATA },
          ctx,
        );
    }
    return { customers: customers.length, payment_intents: created };
  }

  async hasAnyCustomer(): Promise<boolean> {
    return (
      (await this.db.selectFrom('customers').select('id').limit(1).executeTakeFirst()) !== undefined
    );
  }

  /** Deletes all payment data. API keys and webhook endpoints are kept. */
  async reset(): Promise<void> {
    await sql`
      TRUNCATE webhook_delivery_attempts, webhook_deliveries, events, refunds, charges,
        checkout_sessions, payment_intents, payment_methods, customers, idempotency_keys, jobs
      RESTART IDENTITY CASCADE
    `.execute(this.db);
  }
}
