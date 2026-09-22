import type { Charge, List } from '@localstripe/contracts';
import type { RequestOptions } from '../http-client.js';
import { autoPaginate } from '../pagination.js';
import type { ChargeListParams } from './params.js';
import { Resource, idPath } from './resource.js';

export class Charges extends Resource {
  retrieve(id: string, options?: RequestOptions): Promise<Charge> {
    return this.get(idPath('/v1/charges/{id}', id), undefined, options);
  }

  list(params: ChargeListParams = {}, options?: RequestOptions): Promise<List<Charge>> {
    return this.get('/v1/charges', params, options);
  }

  listAll(params: ChargeListParams = {}, options?: RequestOptions) {
    return autoPaginate((page) => this.list(page, options), params);
  }
}
