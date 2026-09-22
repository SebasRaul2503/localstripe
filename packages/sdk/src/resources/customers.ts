import type { Customer, DeletedObject, List, PaymentMethod } from '@localstripe/contracts';
import type { RequestOptions } from '../http-client.js';
import { autoPaginate } from '../pagination.js';
import type {
  CustomerCreateParams,
  CustomerListParams,
  CustomerPaymentMethodListParams,
  CustomerUpdateParams,
} from './params.js';
import { Resource, idPath } from './resource.js';

export class Customers extends Resource {
  create(params: CustomerCreateParams = {}, options?: RequestOptions): Promise<Customer> {
    return this.post('/v1/customers', params, options);
  }

  /** Deleted customers are returned as `{ id, object: 'customer', deleted: true }`. */
  retrieve(id: string, options?: RequestOptions): Promise<Customer | DeletedObject> {
    return this.get(idPath('/v1/customers/{id}', id), undefined, options);
  }

  update(id: string, params: CustomerUpdateParams, options?: RequestOptions): Promise<Customer> {
    return this.post(idPath('/v1/customers/{id}', id), params, options);
  }

  del(id: string, options?: RequestOptions): Promise<DeletedObject> {
    return this.delete(idPath('/v1/customers/{id}', id), options);
  }

  list(params: CustomerListParams = {}, options?: RequestOptions): Promise<List<Customer>> {
    return this.get('/v1/customers', params, options);
  }

  listAll(params: CustomerListParams = {}, options?: RequestOptions) {
    return autoPaginate((page) => this.list(page, options), params);
  }

  listPaymentMethods(
    id: string,
    params: CustomerPaymentMethodListParams = {},
    options?: RequestOptions,
  ): Promise<List<PaymentMethod>> {
    return this.get(idPath('/v1/customers/{id}/payment_methods', id), params, options);
  }
}
