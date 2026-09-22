import type { Address, Customer, DeletedObject, List } from '@localstripe/contracts';
import { type Db, type Executor, json } from '../../infrastructure/database.js';
import type { EventService } from '../events/event.service.js';
import { newId } from '../../shared/ids.js';
import { invalidRequest, notFound } from '../../shared/errors.js';
import type { Origin } from '../../shared/context.js';
import { paginate, type PageRequest } from '../../shared/pagination.js';
import { diff, escapeLike } from '../../shared/objects.js';
import { applyMetadata, createMetadata, type MetadataInput } from '../../shared/validation.js';
import { type CustomerRow, toCustomerResource } from './customer.mapper.js';

type AddressInput = { [K in keyof Address]?: string | null };

export interface CustomerInput {
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  description?: string | null;
  address?: AddressInput | null;
  metadata?: MetadataInput;
  invoice_settings?: { default_payment_method?: string | null };
}

export interface CustomerFilters {
  email?: string;
  query?: string;
}

const toAddress = (input: AddressInput | null | undefined): Address | null =>
  input
    ? {
        city: input.city ?? null,
        country: input.country ?? null,
        line1: input.line1 ?? null,
        line2: input.line2 ?? null,
        postal_code: input.postal_code ?? null,
        state: input.state ?? null,
      }
    : null;

export class CustomerService {
  constructor(
    private readonly db: Db,
    private readonly events: EventService,
  ) {}

  /** Returns the customer row, including soft-deleted ones. */
  async findRow(executor: Executor, id: string): Promise<CustomerRow | undefined> {
    return executor.selectFrom('customers').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async requireActive(executor: Executor, id: string, param = 'customer'): Promise<CustomerRow> {
    const row = await this.findRow(executor, id);
    if (!row || row.deletedAt) throw notFound('customer', id, param);
    return row;
  }

  async ensureActive(id: string, param = 'customer'): Promise<void> {
    await this.requireActive(this.db, id, param);
  }

  async create(input: CustomerInput, origin: Origin): Promise<Customer> {
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto('customers')
        .values({
          id: newId('customer'),
          email: input.email ?? null,
          name: input.name ?? null,
          phone: input.phone ?? null,
          description: input.description ?? null,
          address: json(toAddress(input.address)),
          metadata: json(createMetadata(input.metadata)),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const customer = toCustomerResource(row);
      await this.events.emit(tx, { type: 'customer.created', object: customer }, origin);
      return customer;
    });
  }

  /** Stripe returns a `deleted: true` stub when retrieving a deleted customer. */
  async retrieve(id: string): Promise<Customer | DeletedObject> {
    const row = await this.findRow(this.db, id);
    if (!row) throw notFound('customer', id);
    if (row.deletedAt) return { id: row.id, object: 'customer', deleted: true };
    return toCustomerResource(row);
  }

  async update(id: string, input: CustomerInput, origin: Origin): Promise<Customer> {
    return this.db.transaction().execute(async (tx) => {
      const current = await tx
        .selectFrom('customers')
        .selectAll()
        .where('id', '=', id)
        .where('deletedAt', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFound('customer', id);

      const defaultPaymentMethod = input.invoice_settings?.default_payment_method;
      if (defaultPaymentMethod) {
        const attached = await tx
          .selectFrom('paymentMethods')
          .select('id')
          .where('id', '=', defaultPaymentMethod)
          .where('customerId', '=', id)
          .executeTakeFirst();
        if (!attached) {
          throw invalidRequest(
            `The payment method '${defaultPaymentMethod}' must be attached to the customer before it can be set as default.`,
            { param: 'invoice_settings[default_payment_method]' },
          );
        }
      }

      const row = await tx
        .updateTable('customers')
        .set({
          ...(input.email !== undefined && { email: input.email }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.address !== undefined && { address: json(toAddress(input.address)) }),
          ...(defaultPaymentMethod !== undefined && { defaultPaymentMethod }),
          metadata: json(applyMetadata(current.metadata, input.metadata)),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      const customer = toCustomerResource(row);
      await this.events.emit(
        tx,
        {
          type: 'customer.updated',
          object: customer,
          previousAttributes: diff(toCustomerResource(current), customer),
        },
        origin,
      );
      return customer;
    });
  }

  async delete(id: string, origin: Origin): Promise<DeletedObject> {
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable('customers')
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where('id', '=', id)
        .where('deletedAt', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw notFound('customer', id);
      await this.events.emit(
        tx,
        { type: 'customer.deleted', object: toCustomerResource(row) },
        origin,
      );
      return { id, object: 'customer', deleted: true };
    });
  }

  async list(filters: CustomerFilters, page: PageRequest): Promise<List<Customer>> {
    return paginate(
      '/v1/customers',
      page,
      ({ cursor, order, take }) => {
        let query = this.db.selectFrom('customers').selectAll().where('deletedAt', 'is', null);
        if (filters.email) query = query.where('email', 'ilike', escapeLike(filters.email));
        const search = filters.query;
        if (search) {
          const pattern = `%${escapeLike(search)}%`;
          query = query.where((eb) =>
            eb.or([
              eb('email', 'ilike', pattern),
              eb('name', 'ilike', pattern),
              eb('id', '=', search),
            ]),
          );
        }
        if (cursor) query = query.where('id', cursor.op, cursor.id);
        return query.orderBy('id', order).limit(take).execute();
      },
      toCustomerResource,
    );
  }

  async count(): Promise<number> {
    const row = await this.db
      .selectFrom('customers')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }
}
