import { useQuery } from '@tanstack/react-query';
import type { Stats } from '@localstripe/contracts';
import { apiClient } from '../../lib/api-client';

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: ({ signal }) => apiClient.get<Stats>('/localstripe/stats', { signal }),
    refetchInterval: 10_000,
  });
}
