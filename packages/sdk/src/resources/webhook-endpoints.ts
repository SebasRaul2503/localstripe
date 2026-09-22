import type { DeletedObject, List, WebhookEndpoint } from '@localstripe/contracts';
import type { RequestOptions } from '../http-client.js';
import { autoPaginate, type ListParams } from '../pagination.js';
import type { WebhookEndpointCreateParams, WebhookEndpointUpdateParams } from './params.js';
import { Resource, idPath } from './resource.js';

export class WebhookEndpoints extends Resource {
  /** The returned endpoint includes its signing `secret` (`whsec_...`) only in this response. */
  create(params: WebhookEndpointCreateParams, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.post('/v1/webhook_endpoints', params, options);
  }

  retrieve(id: string, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.get(idPath('/v1/webhook_endpoints/{id}', id), undefined, options);
  }

  update(
    id: string,
    params: WebhookEndpointUpdateParams,
    options?: RequestOptions,
  ): Promise<WebhookEndpoint> {
    return this.post(idPath('/v1/webhook_endpoints/{id}', id), params, options);
  }

  del(id: string, options?: RequestOptions): Promise<DeletedObject> {
    return this.delete(idPath('/v1/webhook_endpoints/{id}', id), options);
  }

  list(params: ListParams = {}, options?: RequestOptions): Promise<List<WebhookEndpoint>> {
    return this.get('/v1/webhook_endpoints', params, options);
  }

  listAll(params: ListParams = {}, options?: RequestOptions) {
    return autoPaginate((page) => this.list(page, options), params);
  }
}
