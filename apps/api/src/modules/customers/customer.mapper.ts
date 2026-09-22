import type { Customer } from '@localstripe/contracts';
import type { CustomersTable } from '../../infrastructure/database.js';
import { toUnix } from '../../shared/time.js';

export type CustomerRow = Pick<
  CustomersTable,
  'id' | 'email' | 'name' | 'phone' | 'description' | 'defaultPaymentMethod' | 'deletedAt'
> & {
  address: Customer['address'];
  metadata: Record<string, string>;
  createdAt: Date;
};

export function toCustomerResource(row: CustomerRow): Customer {
  return {
    id: row.id,
    object: 'customer',
    address: row.address ?? null,
    created: toUnix(row.createdAt),
    description: row.description,
    email: row.email,
    invoice_settings: { default_payment_method: row.defaultPaymentMethod },
    livemode: false,
    metadata: row.metadata,
    name: row.name,
    phone: row.phone,
  };
}
