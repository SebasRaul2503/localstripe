import type { ApiKeyType } from '@localstripe/contracts';

export interface AuthenticatedKey {
  id: string;
  type: ApiKeyType;
  internal: boolean;
}

/** Where a state change came from; recorded on the events it produces. */
export interface Origin {
  requestId: string | null;
  idempotencyKey: string | null;
}

export interface RequestContext extends Origin {
  apiKey: AuthenticatedKey;
  delayOverrideMs?: number;
}

export const SYSTEM_ORIGIN: Origin = { requestId: null, idempotencyKey: null };
