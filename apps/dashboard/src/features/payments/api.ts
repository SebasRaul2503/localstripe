import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Charge,
  List,
  PaymentIntent,
  PaymentIntentStatus,
  PaymentMethod,
  RefundReason,
  Refund,
} from '@localstripe/contracts';
import { ApiError, apiClient, type QueryParams } from '../../lib/api-client';
import { invalidateData } from '../../lib/query';

export interface PaymentIntentFilters extends QueryParams {
  limit?: number;
  starting_after?: string | undefined;
  ending_before?: string | undefined;
  status?: PaymentIntentStatus | '' | undefined;
  customer?: string | undefined;
}

export function usePaymentIntents(params: PaymentIntentFilters) {
  return useQuery({
    queryKey: ['payment_intents', 'list', params],
    queryFn: ({ signal }) =>
      apiClient.get<List<PaymentIntent>>('/payment_intents', { query: params, signal }),
    placeholderData: (previous) => previous,
  });
}

export function usePaymentIntent(id: string) {
  return useQuery({
    queryKey: ['payment_intents', 'detail', id],
    queryFn: ({ signal }) =>
      apiClient.get<PaymentIntent>(`/payment_intents/${encodeURIComponent(id)}`, { signal }),
    refetchInterval: (query) => (query.state.data?.status === 'processing' ? 2_000 : false),
  });
}

export function useCharge(id: string | null | undefined) {
  return useQuery({
    queryKey: ['charges', 'detail', id],
    queryFn: ({ signal }) =>
      apiClient.get<Charge>(`/charges/${encodeURIComponent(id ?? '')}`, { signal }),
    enabled: Boolean(id),
  });
}

export function usePaymentMethod(id: string | null | undefined) {
  return useQuery({
    queryKey: ['payment_methods', 'detail', id],
    queryFn: ({ signal }) =>
      apiClient.get<PaymentMethod>(`/payment_methods/${encodeURIComponent(id ?? '')}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useCreateRefund(paymentIntentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { amount: number; reason?: RefundReason | undefined }) =>
      apiClient.post<Refund>('/refunds', { payment_intent: paymentIntentId, ...input }),
    onSuccess: () => invalidateData(client),
  });
}

export function useCancelPaymentIntent(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<PaymentIntent>(`/payment_intents/${encodeURIComponent(id)}/cancel`),
    onSuccess: () => invalidateData(client),
  });
}

export function useAuthenticatePaymentIntent(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (outcome: 'succeed' | 'fail') => {
      try {
        return await apiClient.post<PaymentIntent>(
          `/localstripe/payment_intents/${encodeURIComponent(id)}/authenticate`,
          { outcome },
        );
      } catch (error) {
        // A failed challenge is an expected card_error outcome, not a crash.
        if (error instanceof ApiError && error.isCardError && error.paymentIntent) {
          return error.paymentIntent;
        }
        throw error;
      }
    },
    onSettled: () => invalidateData(client),
  });
}

export interface TestPaymentInput {
  amount: number;
  currency: string;
  cardNumber: string;
  customer?: string | undefined;
  delayMs?: number | undefined;
}

export type TestPaymentResult =
  | { outcome: 'created'; paymentIntent: PaymentIntent }
  | { outcome: 'declined'; paymentIntent: PaymentIntent | undefined; error: ApiError };

export function useCreateTestPayment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: TestPaymentInput): Promise<TestPaymentResult> => {
      const paymentMethod = await apiClient.post<PaymentMethod>('/payment_methods', {
        type: 'card',
        card: {
          number: input.cardNumber,
          exp_month: 12,
          exp_year: new Date().getFullYear() + 3,
          cvc: '123',
        },
      });
      const headers: Record<string, string> = {};
      if (input.delayMs) headers['LocalStripe-Delay-Ms'] = String(input.delayMs);
      try {
        const paymentIntent = await apiClient.post<PaymentIntent>(
          '/payment_intents',
          {
            amount: input.amount,
            currency: input.currency,
            payment_method: paymentMethod.id,
            confirm: true,
            ...(input.customer ? { customer: input.customer } : {}),
          },
          { headers },
        );
        return { outcome: 'created', paymentIntent };
      } catch (error) {
        if (error instanceof ApiError && error.isCardError) {
          return { outcome: 'declined', paymentIntent: error.paymentIntent, error };
        }
        throw error;
      }
    },
    onSettled: () => invalidateData(client),
  });
}
