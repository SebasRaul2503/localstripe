import type { FastifyInstance } from 'fastify';
import type { IdempotencyService } from '../modules/idempotency/idempotency.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyRecordId?: number;
  }
}

/**
 * Runs after authentication and validation (preHandler), so requests rejected by validation
 * never consume an idempotency key, matching Stripe's behavior.
 */
export function registerIdempotency(app: FastifyInstance, idempotency: IdempotencyService) {
  app.addHook('preHandler', async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (request.method !== 'POST' || typeof key !== 'string' || !request.apiKey) return;

    const decision = await idempotency.begin({
      apiKeyId: request.apiKey.id,
      key,
      method: request.method,
      path: request.url.split('?')[0]!,
      body: request.body ?? {},
    });
    if (decision.kind === 'replay') {
      request.log.info({ idempotencyKey: key }, 'idempotent replay');
      return reply
        .status(decision.statusCode)
        .header('idempotent-replayed', 'true')
        .header('content-type', 'application/json; charset=utf-8')
        .send(decision.body);
    }
    request.idempotencyRecordId = decision.recordId;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const recordId = request.idempotencyRecordId;
    if (recordId === undefined) return payload;
    request.idempotencyRecordId = undefined;
    if (reply.statusCode >= 500) {
      await idempotency.release(recordId);
    } else {
      const body = typeof payload === 'string' ? JSON.parse(payload) : payload;
      await idempotency.complete(recordId, reply.statusCode, body);
    }
    return payload;
  });
}
