import type { CardBrand, Charge, List } from '@localstripe/contracts';
import { type Db, type Executor, json } from '../../infrastructure/database.js';
import { newId } from '../../shared/ids.js';
import { notFound } from '../../shared/errors.js';
import { paginate, type PageRequest } from '../../shared/pagination.js';
import { toUnix } from '../../shared/time.js';
import type { Decline } from '../payment-intents/outcome.js';

export interface ChargeRow {
  id: string;
  paymentIntentId: string;
  paymentMethodId: string;
  customerId: string | null;
  amount: number;
  amountRefunded: number;
  currency: string;
  status: 'succeeded' | 'pending' | 'failed';
  failureCode: string | null;
  failureMessage: string | null;
  declineCode: string | null;
  description: string | null;
  metadata: Record<string, string>;
  createdAt: Date;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface NewCharge {
  paymentIntentId: string;
  paymentMethodId: string;
  customerId: string | null;
  amount: number;
  currency: string;
  description: string | null;
  metadata: Record<string, string>;
  decline?: Decline;
}

export function toChargeResource(row: ChargeRow): Charge {
  const succeeded = row.status === 'succeeded';
  return {
    id: row.id,
    object: 'charge',
    amount: row.amount,
    amount_captured: succeeded ? row.amount : 0,
    amount_refunded: row.amountRefunded,
    captured: succeeded,
    created: toUnix(row.createdAt),
    currency: row.currency,
    customer: row.customerId,
    description: row.description,
    failure_code: row.failureCode,
    failure_message: row.failureMessage,
    livemode: false,
    metadata: row.metadata,
    outcome: succeeded
      ? {
          network_status: 'approved_by_network',
          reason: null,
          seller_message: 'Payment complete (simulated by LocalStripe).',
          type: 'authorized',
        }
      : {
          network_status: 'declined_by_network',
          reason: row.declineCode,
          seller_message: 'The simulated bank declined the payment.',
          type: 'issuer_declined',
        },
    paid: succeeded,
    payment_intent: row.paymentIntentId,
    payment_method: row.paymentMethodId,
    payment_method_details: {
      type: 'card',
      card: {
        brand: row.brand as CardBrand,
        last4: row.last4,
        exp_month: row.expMonth,
        exp_year: row.expYear,
      },
    },
    refunded: row.amountRefunded >= row.amount && row.amount > 0,
    status: row.status,
  };
}

export class ChargeService {
  constructor(private readonly db: Db) {}

  private query(executor: Executor) {
    return executor
      .selectFrom('charges')
      .innerJoin('paymentMethods', 'paymentMethods.id', 'charges.paymentMethodId')
      .selectAll('charges')
      .select([
        'paymentMethods.brand',
        'paymentMethods.last4',
        'paymentMethods.expMonth',
        'paymentMethods.expYear',
      ]);
  }

  async create(executor: Executor, input: NewCharge): Promise<ChargeRow> {
    const id = newId('charge');
    await executor
      .insertInto('charges')
      .values({
        id,
        paymentIntentId: input.paymentIntentId,
        paymentMethodId: input.paymentMethodId,
        customerId: input.customerId,
        amount: input.amount,
        currency: input.currency,
        status: input.decline ? 'failed' : 'succeeded',
        failureCode: input.decline?.code ?? null,
        failureMessage: input.decline?.message ?? null,
        declineCode: input.decline?.declineCode ?? null,
        description: input.description,
        metadata: json(input.metadata),
      })
      .execute();
    return this.requireRow(executor, id);
  }

  async requireRow(executor: Executor, id: string, param = 'id'): Promise<ChargeRow> {
    const row = await this.query(executor).where('charges.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('charge', id, param);
    return row;
  }

  /** Locks the charge row so concurrent refunds are serialized. */
  async lockRow(executor: Executor, id: string, param = 'charge'): Promise<ChargeRow> {
    const locked = await executor
      .selectFrom('charges')
      .select('id')
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!locked) throw notFound('charge', id, param);
    return this.requireRow(executor, id, param);
  }

  async retrieve(id: string): Promise<Charge> {
    return toChargeResource(await this.requireRow(this.db, id));
  }

  async list(
    filters: { paymentIntent?: string; customer?: string },
    page: PageRequest,
  ): Promise<List<Charge>> {
    return paginate(
      '/v1/charges',
      page,
      ({ cursor, order, take }) => {
        let query = this.query(this.db);
        if (filters.paymentIntent)
          query = query.where('charges.paymentIntentId', '=', filters.paymentIntent);
        if (filters.customer) query = query.where('charges.customerId', '=', filters.customer);
        if (cursor) query = query.where('charges.id', cursor.op, cursor.id);
        return query.orderBy('charges.id', order).limit(take).execute();
      },
      toChargeResource,
    );
  }
}
