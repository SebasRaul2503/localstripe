import { useQuery } from '@tanstack/react-query';
import type { List, Refund } from '@localstripe/contracts';
import { apiClient, type QueryParams } from '../../lib/api-client';

export interface RefundFilters extends QueryParams {
  limit?: number;
  starting_after?: string | undefined;
  ending_before?: string | undefined;
  payment_intent?: string | undefined;
}

export function useRefunds(params: RefundFilters) {
  return useQuery({
    queryKey: ['refunds', 'list', params],
    queryFn: ({ signal }) => apiClient.get<List<Refund>>('/refunds', { query: params, signal }),
    placeholderData: (previous) => previous,
  });
}

export function useRefund(id: string) {
  return useQuery({
    queryKey: ['refunds', 'detail', id],
    queryFn: ({ signal }) =>
      apiClient.get<Refund>(`/refunds/${encodeURIComponent(id)}`, { signal }),
  });
}
