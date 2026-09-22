import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { List, LocalStripeEvent, WebhookDelivery } from '@localstripe/contracts';
import { apiClient, type QueryParams } from '../../lib/api-client';
import { invalidateData } from '../../lib/query';

export interface EventFilters extends QueryParams {
  limit?: number;
  starting_after?: string | undefined;
  ending_before?: string | undefined;
  type?: string | undefined;
  object_id?: string | undefined;
}

export function useEvents(params: EventFilters, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['events', 'list', params],
    queryFn: ({ signal }) =>
      apiClient.get<List<LocalStripeEvent>>('/events', { query: params, signal }),
    placeholderData: (previous) => previous,
    enabled: options.enabled ?? true,
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: ['events', 'detail', id],
    queryFn: ({ signal }) =>
      apiClient.get<LocalStripeEvent>(`/events/${encodeURIComponent(id)}`, { signal }),
  });
}

export function useResendEvent(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<List<WebhookDelivery>>(`/localstripe/events/${encodeURIComponent(id)}/resend`),
    onSuccess: () => invalidateData(client),
  });
}

/** Link target for the object an event is about, when the dashboard has a page for it. */
export function objectPath(object: Record<string, unknown>): string | null {
  const id = typeof object['id'] === 'string' ? object['id'] : null;
  if (!id) return null;
  switch (object['object']) {
    case 'payment_intent':
      return `/payments/${id}`;
    case 'customer':
      return `/customers/${id}`;
    case 'refund':
      return `/refunds/${id}`;
    case 'checkout.session':
      return `/checkout-sessions/${id}`;
    case 'charge':
      return typeof object['payment_intent'] === 'string'
        ? `/payments/${object['payment_intent']}`
        : null;
    case 'payment_method':
      return typeof object['customer'] === 'string' ? `/customers/${object['customer']}` : null;
    default:
      return null;
  }
}
