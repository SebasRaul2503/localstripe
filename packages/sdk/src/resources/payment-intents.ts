import type { List, PaymentIntent } from '@localstripe/contracts';
import type { RequestOptions } from '../http-client.js';
import { autoPaginate } from '../pagination.js';
import type {
  PaymentIntentCancelParams,
  PaymentIntentConfirmParams,
  PaymentIntentCreateParams,
  PaymentIntentListParams,
  PaymentIntentUpdateParams,
} from './params.js';
import { Resource, idPath } from './resource.js';

export class PaymentIntents extends Resource {
  create(params: PaymentIntentCreateParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.post('/v1/payment_intents', params, options);
  }

  retrieve(
    id: string,
    params: { client_secret?: string } = {},
    options?: RequestOptions,
  ): Promise<PaymentIntent> {
    return this.get(idPath('/v1/payment_intents/{id}', id), params, options);
  }

  update(
    id: string,
    params: PaymentIntentUpdateParams,
    options?: RequestOptions,
  ): Promise<PaymentIntent> {
    return this.post(idPath('/v1/payment_intents/{id}', id), params, options);
  }

  /** Declines reject with a `CardError` whose `paymentIntent` holds the updated PaymentIntent. */
  confirm(
    id: string,
    params: PaymentIntentConfirmParams = {},
    options?: RequestOptions,
  ): Promise<PaymentIntent> {
    return this.post(idPath('/v1/payment_intents/{id}/confirm', id), params, options);
  }

  cancel(
    id: string,
    params: PaymentIntentCancelParams = {},
    options?: RequestOptions,
  ): Promise<PaymentIntent> {
    return this.post(idPath('/v1/payment_intents/{id}/cancel', id), params, options);
  }

  list(
    params: PaymentIntentListParams = {},
    options?: RequestOptions,
  ): Promise<List<PaymentIntent>> {
    return this.get('/v1/payment_intents', params, options);
  }

  listAll(params: PaymentIntentListParams = {}, options?: RequestOptions) {
    return autoPaginate((page) => this.list(page, options), params);
  }
}
