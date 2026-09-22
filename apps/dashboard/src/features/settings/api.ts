import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { invalidateData } from '../../lib/query';

export interface LocalStripeConfig {
  object: 'localstripe_config';
  version: string;
  public_api_url: string;
  strict_params: boolean;
  payments: {
    global_delay_ms: number;
    scenario_delays_ms: Record<string, number>;
    max_delay_ms: number;
    custom_catalog: boolean;
  };
  webhooks: { max_attempts: number; retry_base_delay_ms: number; timeout_ms: number };
  checkout: { session_ttl_minutes: number };
}

export interface SeedResult {
  object: 'seed_result';
  customers?: number;
  payment_intents?: number;
}

export function useLocalStripeConfig() {
  return useQuery({
    queryKey: ['localstripe_config'],
    queryFn: ({ signal }) => apiClient.get<LocalStripeConfig>('/localstripe/config', { signal }),
  });
}

export function useSeed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<SeedResult>('/localstripe/seed'),
    onSuccess: () => invalidateData(client),
  });
}

export function useReset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<{ reset: boolean }>('/localstripe/reset', { confirm: true }),
    onSuccess: () => invalidateData(client),
  });
}
