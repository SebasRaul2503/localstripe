import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Customer, DeletedObject, List, PaymentMethod } from '@localstripe/contracts';
import { apiClient, type QueryParams } from '../../lib/api-client';
import { invalidateData } from '../../lib/query';

export interface CustomerFilters extends QueryParams {
  limit?: number;
  starting_after?: string | undefined;
  ending_before?: string | undefined;
  query?: string | undefined;
}

export function useCustomers(params: CustomerFilters) {
  return useQuery({
    queryKey: ['customers', 'list', params],
    queryFn: ({ signal }) => apiClient.get<List<Customer>>('/customers', { query: params, signal }),
    placeholderData: (previous) => previous,
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: ({ signal }) =>
      apiClient.get<Customer | DeletedObject>(`/customers/${encodeURIComponent(id)}`, { signal }),
  });
}

export function useCustomerPaymentMethods(id: string) {
  return useQuery({
    queryKey: ['payment_methods', 'list', { customer: id }],
    queryFn: ({ signal }) =>
      apiClient.get<List<PaymentMethod>>(`/customers/${encodeURIComponent(id)}/payment_methods`, {
        query: { limit: 100 },
        signal,
      }),
  });
}

export interface CreateCustomerInput {
  email?: string;
  name?: string;
  description?: string;
}

export function useCreateCustomer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) => apiClient.post<Customer>('/customers', input),
    onSuccess: () => invalidateData(client),
  });
}

export function useDeleteCustomer(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete<DeletedObject>(`/customers/${encodeURIComponent(id)}`),
    onSuccess: () => invalidateData(client),
  });
}
