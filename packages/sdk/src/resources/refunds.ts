import type { List, Refund } from '@localstripe/contracts';
import type { RequestOptions } from '../http-client.js';
import { autoPaginate } from '../pagination.js';
import type { RefundCreateParams, RefundListParams, RefundUpdateParams } from './params.js';
import { Resource, idPath } from './resource.js';

export class Refunds extends Resource {
  create(params: RefundCreateParams, options?: RequestOptions): Promise<Refund> {
    return this.post('/v1/refunds', params, options);
  }

  retrieve(id: string, options?: RequestOptions): Promise<Refund> {
    return this.get(idPath('/v1/refunds/{id}', id), undefined, options);
  }

  update(id: string, params: RefundUpdateParams, options?: RequestOptions): Promise<Refund> {
    return this.post(idPath('/v1/refunds/{id}', id), params, options);
  }

  list(params: RefundListParams = {}, options?: RequestOptions): Promise<List<Refund>> {
    return this.get('/v1/refunds', params, options);
  }

  listAll(params: RefundListParams = {}, options?: RequestOptions) {
    return autoPaginate((page) => this.list(page, options), params);
  }
}
