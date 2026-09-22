import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CheckoutSession,
  CheckoutSessionStatus,
  LineItem,
  List,
} from '@localstripe/contracts';
import { apiClient, type QueryParams } from '../../lib/api-client';
import { invalidateData } from '../../lib/query';

export interface CheckoutFilters extends QueryParams {
  limit?: number;
  starting_after?: string | undefined;
  ending_before?: string | undefined;
  status?: CheckoutSessionStatus | undefined;
}

export function useCheckoutSessions(params: CheckoutFilters) {
  return useQuery({
    queryKey: ['checkout_sessions', 'list', params],
    queryFn: ({ signal }) =>
      apiClient.get<List<CheckoutSession>>('/checkout/sessions', { query: params, signal }),
    placeholderData: (previous) => previous,
  });
}

export function useCheckoutSession(id: string) {
  return useQuery({
    queryKey: ['checkout_sessions', 'detail', id],
    queryFn: ({ signal }) =>
      apiClient.get<CheckoutSession>(`/checkout/sessions/${encodeURIComponent(id)}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useCheckoutLineItems(id: string) {
  return useQuery({
    queryKey: ['checkout_sessions', 'line_items', id],
    queryFn: ({ signal }) =>
      apiClient.get<List<LineItem>>(`/checkout/sessions/${encodeURIComponent(id)}/line_items`, {
        query: { limit: 100 },
        signal,
      }),
  });
}

export function useExpireCheckoutSession(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<CheckoutSession>(`/checkout/sessions/${encodeURIComponent(id)}/expire`),
    onSuccess: () => invalidateData(client),
  });
}

export interface CreateCheckoutInput {
  name: string;
  unitAmount: number;
  quantity: number;
  currency: string;
  successUrl: string;
  cancelUrl?: string | undefined;
  customerEmail?: string | undefined;
}

export function useCreateCheckoutSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCheckoutInput) =>
      apiClient.post<CheckoutSession>('/checkout/sessions', {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: input.currency,
              unit_amount: input.unitAmount,
              product_data: { name: input.name },
            },
            quantity: input.quantity,
          },
        ],
        success_url: input.successUrl,
        ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
        ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
      }),
    onSuccess: () => invalidateData(client),
  });
}
