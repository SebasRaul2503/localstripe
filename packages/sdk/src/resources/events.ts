import type { List, LocalStripeEvent } from '@localstripe/contracts';
import type { RequestOptions } from '../http-client.js';
import { autoPaginate } from '../pagination.js';
import type { EventListParams } from './params.js';
import { Resource, idPath } from './resource.js';

export class Events extends Resource {
  retrieve(id: string, options?: RequestOptions): Promise<LocalStripeEvent> {
    return this.get(idPath('/v1/events/{id}', id), undefined, options);
  }

  list(params: EventListParams = {}, options?: RequestOptions): Promise<List<LocalStripeEvent>> {
    return this.get('/v1/events', params, options);
  }

  listAll(params: EventListParams = {}, options?: RequestOptions) {
    return autoPaginate((page) => this.list(page, options), params);
  }
}
