import { createHash } from 'node:crypto';
import type {
  Address,
  BillingDetails,
  CardBrand,
  CardFunding,
  List,
  PaymentMethod,
} from '@localstripe/contracts';
import { type Db, type Executor, json, type Tx } from '../../infrastructure/database.js';
import type { EventService } from '../events/event.service.js';
import type { CustomerService } from '../customers/customer.service.js';
import type { CatalogCard, TestCardCatalog } from '../test-cards/catalog.js';
import { newId } from '../../shared/ids.js';
import { invalidRequest, notFound, unexpectedState } from '../../shared/errors.js';
import type { Origin } from '../../shared/context.js';
import { paginate, type PageRequest } from '../../shared/pagination.js';
import { applyMetadata, createMetadata, type MetadataInput } from '../../shared/validation.js';
import { toUnix } from '../../shared/time.js';
import { type CardInput, validateCard } from './card-validation.js';

export interface BillingDetailsInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: { [K in keyof Address]?: string | null } | null;
}

export interface CreatePaymentMethodInput {
  type: 'card';
  card: CardInput;
  billing_details?: BillingDetailsInput;
  metadata?: MetadataInput;
}

export interface UpdatePaymentMethodInput {
  billing_details?: BillingDetailsInput;
  metadata?: MetadataInput;
  card?: { exp_month?: number; exp_year?: number };
}

export type PaymentMethodRow = {
  id: string;
  customerId: string | null;
  testCardId: string;
  brand: string;
  funding: string;
  last4: string;
  expMonth: number;
  expYear: number;
  fingerprint: string;
  billingDetails: BillingDetails;
  metadata: Record<string, string>;
  createdAt: Date;
};

const emptyBillingDetails: BillingDetails = { address: null, email: null, name: null, phone: null };

function toBillingDetails(
  input: BillingDetailsInput | undefined,
  base = emptyBillingDetails,
): BillingDetails {
  if (!input) return base;
  return {
    name: input.name !== undefined ? input.name : base.name,
    email: input.email !== undefined ? input.email : base.email,
    phone: input.phone !== undefined ? input.phone : base.phone,
    address:
      input.address === undefined
        ? base.address
        : input.address === null
          ? null
          : {
              city: input.address.city ?? null,
              country: input.address.country ?? null,
              line1: input.address.line1 ?? null,
              line2: input.address.line2 ?? null,
              postal_code: input.address.postal_code ?? null,
              state: input.address.state ?? null,
            },
  };
}

export const cardFingerprint = (card: CatalogCard): string =>
  createHash('sha256').update(`localstripe:${card.id}`).digest('base64url').slice(0, 16);

export function toPaymentMethodResource(row: PaymentMethodRow): PaymentMethod {
  return {
    id: row.id,
    object: 'payment_method',
    billing_details: row.billingDetails,
    card: {
      brand: row.brand as CardBrand,
      country: 'US',
      exp_month: row.expMonth,
      exp_year: row.expYear,
      fingerprint: row.fingerprint,
      funding: row.funding as CardFunding,
      last4: row.last4,
    },
    created: toUnix(row.createdAt),
    customer: row.customerId,
    livemode: false,
    metadata: row.metadata,
    type: 'card',
  };
}

export class PaymentMethodService {
  constructor(
    private readonly db: Db,
    private readonly events: EventService,
    private readonly customers: CustomerService,
    private readonly catalog: TestCardCatalog,
  ) {}

  private async insert(
    executor: Executor,
    card: CatalogCard,
    expiry: { expMonth: number; expYear: number },
    billingDetails: BillingDetails,
    metadata: Record<string, string>,
  ): Promise<PaymentMethodRow> {
    return executor
      .insertInto('paymentMethods')
      .values({
        id: newId('paymentMethod'),
        testCardId: card.id,
        brand: card.brand,
        funding: card.funding,
        last4: card.number.slice(-4),
        expMonth: expiry.expMonth,
        expYear: expiry.expYear,
        fingerprint: cardFingerprint(card),
        billingDetails: json(billingDetails),
        metadata: json(metadata),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async create(input: CreatePaymentMethodInput): Promise<PaymentMethod> {
    const validated = validateCard(input.card, this.catalog);
    const row = await this.insert(
      this.db,
      validated.card,
      validated,
      toBillingDetails(input.billing_details),
      createMetadata(input.metadata),
    );
    return toPaymentMethodResource(row);
  }

  async findRow(executor: Executor, id: string): Promise<PaymentMethodRow | undefined> {
    return executor
      .selectFrom('paymentMethods')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async requireRow(executor: Executor, id: string, param = 'id'): Promise<PaymentMethodRow> {
    const row = await this.findRow(executor, id);
    if (!row) throw notFound('payment_method', id, param);
    return row;
  }

  /**
   * Resolves the `payment_method` param of a payment. Stripe-style test tokens such as
   * `pm_card_visa` create a fresh payment method from the catalog, like Stripe test mode does.
   */
  async resolveForPayment(
    executor: Executor,
    idOrToken: string,
    param = 'payment_method',
  ): Promise<PaymentMethodRow> {
    const card = this.catalog.findByToken(idOrToken);
    if (card) {
      const nextYear = new Date().getUTCFullYear() + 1;
      return this.insert(
        executor,
        card,
        { expMonth: 12, expYear: nextYear },
        emptyBillingDetails,
        {},
      );
    }
    return this.requireRow(executor, idOrToken, param);
  }

  /** The catalog entry behind a payment method; fails if the catalog no longer contains it. */
  catalogCardFor(row: PaymentMethodRow): CatalogCard {
    const card = this.catalog.findById(row.testCardId);
    if (!card) {
      throw unexpectedState(
        'payment_method_unexpected_state',
        `The test card behind payment method '${row.id}' is no longer in the test card catalog.`,
        { param: 'payment_method' },
      );
    }
    return card;
  }

  async retrieve(id: string): Promise<PaymentMethod> {
    return toPaymentMethodResource(await this.requireRow(this.db, id));
  }

  async update(id: string, input: UpdatePaymentMethodInput): Promise<PaymentMethod> {
    return this.db.transaction().execute(async (tx) => {
      const current = await tx
        .selectFrom('paymentMethods')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFound('payment_method', id);

      if (input.card?.exp_month !== undefined || input.card?.exp_year !== undefined) {
        const card = this.catalogCardFor(current);
        validateCard(
          {
            number: card.number,
            exp_month: input.card.exp_month ?? current.expMonth,
            exp_year: input.card.exp_year ?? current.expYear,
          },
          this.catalog,
        );
      }

      const row = await tx
        .updateTable('paymentMethods')
        .set({
          billingDetails: json(toBillingDetails(input.billing_details, current.billingDetails)),
          metadata: json(applyMetadata(current.metadata, input.metadata)),
          ...(input.card?.exp_month !== undefined && { expMonth: input.card.exp_month }),
          ...(input.card?.exp_year !== undefined && {
            expYear: input.card.exp_year < 100 ? 2000 + input.card.exp_year : input.card.exp_year,
          }),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toPaymentMethodResource(row);
    });
  }

  async attach(id: string, customerId: string, origin: Origin): Promise<PaymentMethod> {
    return this.db.transaction().execute(async (tx) => {
      await this.customers.requireActive(tx, customerId);
      const current = await this.lock(tx, id);
      if (current.customerId && current.customerId !== customerId) {
        throw unexpectedState(
          'payment_method_unexpected_state',
          `The payment method '${id}' is already attached to another customer.`,
        );
      }
      if (current.customerId === customerId) return toPaymentMethodResource(current);

      const row = await tx
        .updateTable('paymentMethods')
        .set({ customerId })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const paymentMethod = toPaymentMethodResource(row);
      await this.events.emit(
        tx,
        { type: 'payment_method.attached', object: paymentMethod },
        origin,
      );
      return paymentMethod;
    });
  }

  async detach(id: string, origin: Origin): Promise<PaymentMethod> {
    return this.db.transaction().execute(async (tx) => {
      const current = await this.lock(tx, id);
      if (!current.customerId) {
        throw unexpectedState(
          'payment_method_unexpected_state',
          `The payment method '${id}' is not attached to a customer.`,
        );
      }
      await tx
        .updateTable('customers')
        .set({ defaultPaymentMethod: null })
        .where('id', '=', current.customerId)
        .where('defaultPaymentMethod', '=', id)
        .execute();
      const row = await tx
        .updateTable('paymentMethods')
        .set({ customerId: null })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const paymentMethod = toPaymentMethodResource(row);
      await this.events.emit(
        tx,
        { type: 'payment_method.detached', object: paymentMethod },
        origin,
      );
      return paymentMethod;
    });
  }

  private async lock(tx: Tx, id: string): Promise<PaymentMethodRow> {
    const row = await tx
      .selectFrom('paymentMethods')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound('payment_method', id);
    return row;
  }

  async list(
    filters: { customer?: string; type?: string },
    page: PageRequest,
    url = '/v1/payment_methods',
  ): Promise<List<PaymentMethod>> {
    if (filters.type && filters.type !== 'card') {
      throw invalidRequest(`LocalStripe only supports payment methods of type 'card'.`, {
        param: 'type',
      });
    }
    return paginate(
      url,
      page,
      ({ cursor, order, take }) => {
        let query = this.db.selectFrom('paymentMethods').selectAll();
        if (filters.customer) query = query.where('customerId', '=', filters.customer);
        if (cursor) query = query.where('id', cursor.op, cursor.id);
        return query.orderBy('id', order).limit(take).execute();
      },
      toPaymentMethodResource,
    );
  }
}
