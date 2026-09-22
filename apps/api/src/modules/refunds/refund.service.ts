import type { List, Refund, RefundReason, RefundStatus } from '@localstripe/contracts';
import { type Db, json } from '../../infrastructure/database.js';
import type { EventService } from '../events/event.service.js';
import { type ChargeService, toChargeResource } from '../charges/charge.service.js';
import type { PaymentIntentService } from '../payment-intents/payment-intent.service.js';
import { newId } from '../../shared/ids.js';
import { invalidRequest, notFound } from '../../shared/errors.js';
import type { Origin } from '../../shared/context.js';
import { paginate, type PageRequest } from '../../shared/pagination.js';
import { applyMetadata, createMetadata, type MetadataInput } from '../../shared/validation.js';
import { toUnix } from '../../shared/time.js';
import { computeRefundAmount } from './refund-calculation.js';

export interface CreateRefundInput {
  payment_intent?: string;
  charge?: string;
  amount?: number;
  reason?: RefundReason;
  metadata?: MetadataInput;
}

interface RefundRow {
  id: string;
  chargeId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  reason: string | null;
  status: string;
  metadata: Record<string, string>;
  createdAt: Date;
}

export function toRefundResource(row: RefundRow): Refund {
  return {
    id: row.id,
    object: 'refund',
    amount: row.amount,
    charge: row.chargeId,
    created: toUnix(row.createdAt),
    currency: row.currency,
    livemode: false,
    metadata: row.metadata,
    payment_intent: row.paymentIntentId,
    reason: row.reason as RefundReason | null,
    status: row.status as RefundStatus,
  };
}

export class RefundService {
  constructor(
    private readonly db: Db,
    private readonly events: EventService,
    private readonly charges: ChargeService,
    private readonly paymentIntents: PaymentIntentService,
  ) {}

  /**
   * Refunds are applied immediately. The charge row is locked for the whole operation, so
   * concurrent refunds can never exceed the captured amount (a CHECK constraint backs this up).
   */
  async create(input: CreateRefundInput, origin: Origin): Promise<Refund> {
    if (!input.payment_intent && !input.charge) {
      throw invalidRequest('One of payment_intent or charge is required.', {
        code: 'parameter_missing',
        param: 'payment_intent',
      });
    }
    return this.db.transaction().execute(async (tx) => {
      let chargeId = input.charge;
      if (input.payment_intent) {
        const paymentIntent = await this.paymentIntents.requireRow(
          tx,
          input.payment_intent,
          'payment_intent',
        );
        if (paymentIntent.status !== 'succeeded' || !paymentIntent.latestChargeId) {
          throw invalidRequest(
            `This PaymentIntent (${paymentIntent.id}) does not have a successful charge to refund (status: ${paymentIntent.status}).`,
            { param: 'payment_intent' },
          );
        }
        if (chargeId && chargeId !== paymentIntent.latestChargeId) {
          throw invalidRequest('The charge does not belong to the given PaymentIntent.', {
            param: 'charge',
          });
        }
        chargeId = paymentIntent.latestChargeId;
      }

      const charge = await this.charges.lockRow(tx, chargeId!);
      const amount = computeRefundAmount(charge, input.amount);

      const refundRow = await tx
        .insertInto('refunds')
        .values({
          id: newId('refund'),
          chargeId: charge.id,
          paymentIntentId: charge.paymentIntentId,
          amount,
          currency: charge.currency,
          reason: input.reason ?? null,
          status: 'succeeded',
          metadata: json(createMetadata(input.metadata)),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await tx
        .updateTable('charges')
        .set((eb) => ({ amountRefunded: eb('amountRefunded', '+', amount) }))
        .where('id', '=', charge.id)
        .execute();

      const refund = toRefundResource(refundRow);
      const updatedCharge = toChargeResource(await this.charges.requireRow(tx, charge.id));
      await this.events.emit(tx, { type: 'refund.created', object: refund }, origin);
      await this.events.emit(
        tx,
        {
          type: 'charge.refunded',
          object: updatedCharge,
          previousAttributes: { amount_refunded: charge.amountRefunded, refunded: false },
        },
        origin,
      );
      return refund;
    });
  }

  async retrieve(id: string): Promise<Refund> {
    const row = await this.db
      .selectFrom('refunds')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound('refund', id);
    return toRefundResource(row);
  }

  async update(id: string, metadata: MetadataInput): Promise<Refund> {
    return this.db.transaction().execute(async (tx) => {
      const current = await tx
        .selectFrom('refunds')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFound('refund', id);
      const row = await tx
        .updateTable('refunds')
        .set({ metadata: json(applyMetadata(current.metadata, metadata)) })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toRefundResource(row);
    });
  }

  async list(
    filters: { paymentIntent?: string; charge?: string },
    page: PageRequest,
  ): Promise<List<Refund>> {
    return paginate(
      '/v1/refunds',
      page,
      ({ cursor, order, take }) => {
        let query = this.db.selectFrom('refunds').selectAll();
        if (filters.paymentIntent)
          query = query.where('paymentIntentId', '=', filters.paymentIntent);
        if (filters.charge) query = query.where('chargeId', '=', filters.charge);
        if (cursor) query = query.where('id', cursor.op, cursor.id);
        return query.orderBy('id', order).limit(take).execute();
      },
      toRefundResource,
    );
  }
}
