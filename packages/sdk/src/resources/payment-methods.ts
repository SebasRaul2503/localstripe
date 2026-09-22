import type { List, PaymentMethod } from '@localstripe/contracts';
import type { RequestOptions } from '../http-client.js';
import { autoPaginate } from '../pagination.js';
import type {
  PaymentMethodCreateParams,
  PaymentMethodListParams,
  PaymentMethodUpdateParams,
} from './params.js';
import { Resource, idPath } from './resource.js';

export class PaymentMethods extends Resource {
  create(params: PaymentMethodCreateParams, options?: RequestOptions): Promise<PaymentMethod> {
    return this.post('/v1/payment_methods', params, options);
  }

  retrieve(id: string, options?: RequestOptions): Promise<PaymentMethod> {
    return this.get(idPath('/v1/payment_methods/{id}', id), undefined, options);
  }

  update(
    id: string,
    params: PaymentMethodUpdateParams,
    options?: RequestOptions,
  ): Promise<PaymentMethod> {
    return this.post(idPath('/v1/payment_methods/{id}', id), params, options);
  }

  list(
    params: PaymentMethodListParams = {},
    options?: RequestOptions,
  ): Promise<List<PaymentMethod>> {
    return this.get('/v1/payment_methods', params, options);
  }

  listAll(params: PaymentMethodListParams = {}, options?: RequestOptions) {
    return autoPaginate((page) => this.list(page, options), params);
  }

  attach(
    id: string,
    params: { customer: string },
    options?: RequestOptions,
  ): Promise<PaymentMethod> {
    return this.post(idPath('/v1/payment_methods/{id}/attach', id), params, options);
  }

  detach(id: string, options?: RequestOptions): Promise<PaymentMethod> {
    return this.post(idPath('/v1/payment_methods/{id}/detach', id), {}, options);
  }
}
