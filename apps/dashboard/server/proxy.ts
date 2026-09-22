import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiKeyProvider } from './api-key.js';

const API_PREFIX = '/api/v1/';

const DROPPED_REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'expect',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'origin',
  'referer',
]);

const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
  'set-cookie',
  'www-authenticate',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
]);

export interface ProxyOptions {
  upstreamUrl: string;
  apiKey: ApiKeyProvider;
  timeoutMs?: number;
}

function sendError(reply: FastifyReply, status: number, message: string, code: string) {
  return reply
    .code(status)
    .type('application/json')
    .send({
      error: { type: 'api_error', code, message },
    });
}

/** Maps `/api/v1/<rest>?<query>` onto the upstream `/v1/<rest>?<query>`; `null` if it escapes `/v1/`. */
export function toUpstreamUrl(requestUrl: string, upstreamUrl: string): URL | null {
  if (!requestUrl.startsWith(API_PREFIX)) return null;
  const base = new URL(upstreamUrl);
  const target = new URL(`/v1/${requestUrl.slice(API_PREFIX.length)}`, base);
  if (target.origin !== base.origin || !target.pathname.startsWith('/v1/')) return null;
  return target;
}

function forwardHeaders(request: FastifyRequest, key: string): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('authorization', `Bearer ${key}`);
  return headers;
}

export async function registerApiProxy(app: FastifyInstance, options: ProxyOptions) {
  const timeoutMs = options.timeoutMs ?? 120_000;

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      const target = toUpstreamUrl(request.url, options.upstreamUrl);
      if (!target) return sendError(reply, 404, 'Not found.', 'resource_missing');

      let key = await options.apiKey.get();
      if (!key) {
        return sendError(
          reply,
          503,
          'The dashboard has no API key yet. Waiting for the LocalStripe API to write the dashboard key (or set DASHBOARD_API_KEY).',
          'dashboard_key_unavailable',
        );
      }

      const body =
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : (request.body as Buffer | undefined);

      const send = (apiKey: string) =>
        fetch(target, {
          method: request.method,
          headers: forwardHeaders(request, apiKey),
          body: body && body.length > 0 ? new Uint8Array(body) : undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });

      let upstream: Response;
      try {
        upstream = await send(key);
        if (upstream.status === 401) {
          const refreshed = await options.apiKey.refresh();
          if (refreshed && refreshed !== key) {
            request.log.info('dashboard API key was rotated; retrying with the new key');
            key = refreshed;
            await upstream.body?.cancel();
            upstream = await send(key);
          }
        }
      } catch (error) {
        request.log.warn({ err: error, target: target.pathname }, 'LocalStripe API unreachable');
        return sendError(reply, 502, 'The LocalStripe API is unreachable.', 'upstream_unavailable');
      }

      reply.code(upstream.status);
      upstream.headers.forEach((value, name) => {
        if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) reply.header(name, value);
      });
      reply.header('cache-control', 'no-store');
      return reply.send(Buffer.from(await upstream.arrayBuffer()));
    };

    scope.all('/api/*', handler);
  });
}
