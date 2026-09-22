import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiKey, ApiKeyType, List } from '@localstripe/contracts';
import { apiClient } from '../../lib/api-client';

export function useApiKeys() {
  return useQuery({
    queryKey: ['api_keys'],
    queryFn: ({ signal }) => apiClient.get<List<ApiKey>>('/localstripe/api_keys', { signal }),
  });
}

export function useCreateApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: ApiKeyType; name: string }) =>
      apiClient.post<ApiKey>('/localstripe/api_keys', input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['api_keys'] }),
  });
}

export function useRevokeApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<ApiKey>(`/localstripe/api_keys/${encodeURIComponent(id)}/revoke`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['api_keys'] }),
  });
}
