import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

const STATIC_KEYS = new Set(['app-config', 'test_cards', 'localstripe_config']);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

/**
 * Most LocalStripe writes ripple into other resources (events, webhook deliveries, stats...),
 * so mutations refresh every data query instead of tracking fine-grained dependencies.
 */
export function invalidateData(client: QueryClient): Promise<void> {
  return client.invalidateQueries({
    predicate: (query) => !STATIC_KEYS.has(String(query.queryKey[0])),
  });
}
