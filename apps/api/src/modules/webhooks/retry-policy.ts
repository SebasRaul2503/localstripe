export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

/**
 * When to try again after a failed attempt (exponential backoff, factor 3, capped at one hour),
 * or `null` when the automatic attempts are exhausted. `attemptsMade` includes the failed one.
 */
export function nextRetryAt(
  attemptsMade: number,
  policy: RetryPolicy,
  now: Date = new Date(),
): Date | null {
  if (attemptsMade >= policy.maxAttempts) return null;
  const delay = Math.min(policy.baseDelayMs * 3 ** (attemptsMade - 1), MAX_RETRY_DELAY_MS);
  return new Date(now.getTime() + delay);
}

export const isSuccessfulResponse = (status: number): boolean => status >= 200 && status < 300;
