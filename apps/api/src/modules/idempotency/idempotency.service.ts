import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { type Db, json } from '../../infrastructure/database.js';
import { ApiError } from '../../shared/errors.js';

/** A request older than this that never completed (e.g. the process crashed) may be retried. */
const STALE_LOCK_MS = 60_000;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export interface IdempotentRequest {
  apiKeyId: string;
  key: string;
  method: string;
  path: string;
  body: unknown;
}

export type IdempotencyDecision =
  { kind: 'proceed'; recordId: number } | { kind: 'replay'; statusCode: number; body: unknown };

/** Stable JSON: object keys sorted, so logically equal payloads hash identically. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const requestFingerprint = (method: string, path: string, body: unknown): string =>
  createHash('sha256')
    .update(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`)
    .digest('hex');

const keyReused = () =>
  new ApiError(
    400,
    'idempotency_error',
    'Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than the one you used.',
    { code: 'idempotency_key_reused' },
  );

const keyInUse = () =>
  new ApiError(
    409,
    'idempotency_error',
    'There is currently another in-progress request using this idempotency key. Retry this request later.',
    { code: 'idempotency_key_in_use' },
  );

/**
 * Stripe-style idempotency. The unique (api_key_id, key) constraint is the arbiter under
 * concurrency: exactly one request wins the insert and executes; the others either replay its
 * stored response, get a 409 while it is still running, or a 400 if their parameters differ.
 */
export class IdempotencyService {
  constructor(private readonly db: Db) {}

  async begin(request: IdempotentRequest): Promise<IdempotencyDecision> {
    if (request.key.length === 0 || request.key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new ApiError(
        400,
        'idempotency_error',
        `Idempotency keys must be between 1 and ${MAX_IDEMPOTENCY_KEY_LENGTH} characters long.`,
        { code: 'parameter_invalid' },
      );
    }
    const hash = requestFingerprint(request.method, request.path, request.body);

    const inserted = await this.db
      .insertInto('idempotencyKeys')
      .values({
        apiKeyId: request.apiKeyId,
        key: request.key,
        requestMethod: request.method,
        requestPath: request.path,
        requestHash: hash,
        status: 'in_progress',
      })
      .onConflict((oc) => oc.columns(['apiKeyId', 'key']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) return { kind: 'proceed', recordId: inserted.id };

    const existing = await this.db
      .selectFrom('idempotencyKeys')
      .selectAll()
      .where('apiKeyId', '=', request.apiKeyId)
      .where('key', '=', request.key)
      .executeTakeFirst();
    // The winner may have released its key (5xx) between our insert and select.
    if (!existing) return this.begin(request);

    if (existing.requestHash !== hash) throw keyReused();
    if (existing.status === 'completed') {
      return { kind: 'replay', statusCode: existing.responseStatus!, body: existing.responseBody };
    }

    const takenOver = await this.db
      .updateTable('idempotencyKeys')
      .set({ lockedAt: new Date() })
      .where('id', '=', existing.id)
      .where('status', '=', 'in_progress')
      .where('lockedAt', '<', new Date(Date.now() - STALE_LOCK_MS))
      .returning('id')
      .executeTakeFirst();
    if (takenOver) return { kind: 'proceed', recordId: takenOver.id };
    throw keyInUse();
  }

  async complete(recordId: number, statusCode: number, body: unknown): Promise<void> {
    await this.db
      .updateTable('idempotencyKeys')
      .set({ status: 'completed', responseStatus: statusCode, responseBody: json(body) })
      .where('id', '=', recordId)
      .execute();
  }

  /** Server errors are not cached, so the client can safely retry with the same key. */
  async release(recordId: number): Promise<void> {
    await this.db.deleteFrom('idempotencyKeys').where('id', '=', recordId).execute();
  }

  async purgeOlderThan(hours: number): Promise<number> {
    const result = await this.db
      .deleteFrom('idempotencyKeys')
      .where('createdAt', '<', sql<Date>`now() - ${`${hours} hours`}::interval`)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}
