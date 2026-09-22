import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiKeyService } from '../modules/api-keys/api-key.service.js';
import type { AuthenticatedKey, RequestContext } from '../shared/context.js';
import { forbidden, unauthenticated } from '../shared/errors.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Publishable keys may call this route (Stripe.js-style client calls). */
    allowPublishable?: boolean;
  }
  interface FastifyRequest {
    apiKey?: AuthenticatedKey;
  }
}

/** Accepts `Authorization: Bearer <key>` and Basic auth with the key as username (curl -u). */
export function extractApiKey(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ', 2);
  if (!value) return null;
  if (scheme?.toLowerCase() === 'bearer') return value.trim();
  if (scheme?.toLowerCase() === 'basic') {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const username = decoded.split(':', 1)[0];
    return username ? username.trim() : null;
  }
  return null;
}

export function registerAuthentication(app: FastifyInstance, apiKeys: ApiKeyService) {
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/v1/')) return;
    const raw = extractApiKey(request.headers.authorization);
    if (!raw) {
      throw unauthenticated(
        'You did not provide an API key. Provide it in the Authorization header using Bearer auth (e.g. "Authorization: Bearer sk_test_...").',
        'api_key_required',
      );
    }
    const key = await apiKeys.authenticate(raw);
    if (!key) throw unauthenticated(`Invalid API Key provided: ${redactForMessage(raw)}`);
    if (key.type === 'publishable' && !request.routeOptions.config.allowPublishable) {
      throw forbidden(
        'This API call cannot be made with a publishable API key. Please use a secret API key.',
      );
    }
    request.apiKey = key;
  });
}

const redactForMessage = (key: string): string =>
  key.length > 12
    ? `${key.slice(0, 8)}${'*'.repeat(Math.min(key.length - 12, 20))}${key.slice(-4)}`
    : '****';

const DELAY_HEADER = 'localstripe-delay-ms';

export function requestContext(request: FastifyRequest): RequestContext {
  if (!request.apiKey) throw unauthenticated('Authentication required.', 'api_key_required');
  const delayHeader = request.headers[DELAY_HEADER];
  const delay =
    typeof delayHeader === 'string' && /^\d{1,7}$/.test(delayHeader)
      ? Number(delayHeader)
      : undefined;
  const idempotencyKey = request.headers['idempotency-key'];
  return {
    requestId: request.id,
    idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null,
    apiKey: request.apiKey,
    delayOverrideMs: delay,
  };
}

export const isPublishable = (request: FastifyRequest): boolean =>
  request.apiKey?.type === 'publishable';
