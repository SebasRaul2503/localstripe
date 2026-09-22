import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DeletedObject,
  List,
  WebhookDelivery,
  WebhookDeliveryAttempt,
  WebhookDeliveryStatus,
  WebhookEndpoint,
} from '@localstripe/contracts';
import { apiClient, type QueryParams } from '../../lib/api-client';
import { invalidateData } from '../../lib/query';

export type WebhookDeliveryDetail = WebhookDelivery & { attempt_history: WebhookDeliveryAttempt[] };

export function useWebhookEndpoints() {
  return useQuery({
    queryKey: ['webhook_endpoints', 'list'],
    queryFn: ({ signal }) =>
      apiClient.get<List<WebhookEndpoint>>('/webhook_endpoints', { query: { limit: 100 }, signal }),
  });
}

export function useCreateWebhookEndpoint() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; enabled_events: string[]; description?: string }) =>
      apiClient.post<WebhookEndpoint>('/webhook_endpoints', input),
    onSuccess: () => invalidateData(client),
  });
}

export function useToggleWebhookEndpoint() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      apiClient.post<WebhookEndpoint>(`/webhook_endpoints/${encodeURIComponent(id)}`, { disabled }),
    onSuccess: () => invalidateData(client),
  });
}

export function useDeleteWebhookEndpoint() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<DeletedObject>(`/webhook_endpoints/${encodeURIComponent(id)}`),
    onSuccess: () => invalidateData(client),
  });
}

export function useRevealWebhookSecret() {
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.get<{ id: string; secret: string }>(
        `/localstripe/webhook_endpoints/${encodeURIComponent(id)}/secret`,
      ),
  });
}

export interface DeliveryFilters extends QueryParams {
  limit?: number;
  starting_after?: string | undefined;
  ending_before?: string | undefined;
  status?: WebhookDeliveryStatus | undefined;
  event?: string | undefined;
  webhook_endpoint?: string | undefined;
}

const hasPending = (list: List<WebhookDelivery> | undefined) =>
  list?.data.some((delivery) => delivery.status === 'pending') ?? false;

export function useWebhookDeliveries(params: DeliveryFilters) {
  return useQuery({
    queryKey: ['webhook_deliveries', 'list', params],
    queryFn: ({ signal }) =>
      apiClient.get<List<WebhookDelivery>>('/localstripe/webhook_deliveries', {
        query: params,
        signal,
      }),
    placeholderData: (previous) => previous,
    refetchInterval: (query) => (hasPending(query.state.data) ? 3_000 : false),
  });
}

export function useWebhookDelivery(id: string | null) {
  return useQuery({
    queryKey: ['webhook_deliveries', 'detail', id],
    queryFn: ({ signal }) =>
      apiClient.get<WebhookDeliveryDetail>(
        `/localstripe/webhook_deliveries/${encodeURIComponent(id ?? '')}`,
        { signal },
      ),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3_000 : false),
  });
}

export function useRetryWebhookDelivery() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<WebhookDelivery>(
        `/localstripe/webhook_deliveries/${encodeURIComponent(id)}/retry`,
      ),
    onSuccess: () => invalidateData(client),
  });
}
