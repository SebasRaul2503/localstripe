import type { HttpClient, RequestOptions } from '../http-client.js';

export const idPath = (template: string, ...ids: string[]) => {
  let index = 0;
  return template.replace(/\{id\}/g, () => encodeURIComponent(ids[index++] ?? ''));
};

export abstract class Resource {
  constructor(protected readonly http: HttpClient) {}

  protected get<T>(path: string, query?: object, options?: RequestOptions): Promise<T> {
    return this.http.request<T>({ method: 'GET', path, query, options });
  }

  protected post<T>(path: string, body: object = {}, options?: RequestOptions): Promise<T> {
    return this.http.request<T>({ method: 'POST', path, body, options });
  }

  protected delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.http.request<T>({ method: 'DELETE', path, options });
  }
}
