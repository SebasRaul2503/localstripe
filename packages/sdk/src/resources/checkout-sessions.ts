import type { CheckoutSession, LineItem, List } from '@localstripe/contracts';
import type { RequestOptions } from '../http-client.js';
import { autoPaginate, type ListParams } from '../pagination.js';
import type { CheckoutSessionCreateParams, CheckoutSessionListParams } from './params.js';
import { Resource, idPath } from './resource.js';

export class CheckoutSessions extends Resource {
  create(params: CheckoutSessionCreateParams, options?: RequestOptions): Promise<CheckoutSession> {
    return this.post('/v1/checkout/sessions', params, options);
  }

  retrieve(id: string, options?: RequestOptions): Promise<CheckoutSession> {
    return this.get(idPath('/v1/checkout/sessions/{id}', id), undefined, options);
  }

  list(
    params: CheckoutSessionListParams = {},
    options?: RequestOptions,
  ): Promise<List<CheckoutSession>> {
    return this.get('/v1/checkout/sessions', params, options);
  }

  listAll(params: CheckoutSessionListParams = {}, options?: RequestOptions) {
    return autoPaginate((page) => this.list(page, options), params);
  }

  listLineItems(
    id: string,
    params: ListParams = {},
    options?: RequestOptions,
  ): Promise<List<LineItem>> {
    return this.get(idPath('/v1/checkout/sessions/{id}/line_items', id), params, options);
  }

  expire(id: string, options?: RequestOptions): Promise<CheckoutSession> {
    return this.post(idPath('/v1/checkout/sessions/{id}/expire', id), {}, options);
  }
}

export class Checkout {
  readonly sessions: CheckoutSessions;

  constructor(sessions: CheckoutSessions) {
    this.sessions = sessions;
  }
}
