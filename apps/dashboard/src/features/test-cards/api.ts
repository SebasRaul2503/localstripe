import { useQuery } from '@tanstack/react-query';
import type { List, TestCard } from '@localstripe/contracts';
import { apiClient } from '../../lib/api-client';

export function useTestCards() {
  return useQuery({
    queryKey: ['test_cards'],
    queryFn: ({ signal }) => apiClient.get<List<TestCard>>('/localstripe/test_cards', { signal }),
    staleTime: 5 * 60_000,
  });
}
