import { useQuery } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import type { List, PaymentMethod } from '@localstripe/contracts';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pagination } from '../../components/ui/Pagination';
import { QueryView } from '../../components/ui/QueryView';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/States';
import { useListParams } from '../../hooks/useListParams';
import { apiClient } from '../../lib/api-client';
import { SeedButton } from '../settings/SeedButton';
import { PaymentMethodsTable } from './PaymentMethodsTable';

const FILTERS = ['customer'] as const;

export function PaymentMethodsPage() {
  const { filters, setFilter, cursor, pageState } = useListParams(FILTERS);
  const params = { ...cursor, customer: filters.customer || undefined };
  const query = useQuery({
    queryKey: ['payment_methods', 'list', params],
    queryFn: ({ signal }) =>
      apiClient.get<List<PaymentMethod>>('/payment_methods', { query: params, signal }),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Payment methods"
        description="Cards created from test card numbers. Only the brand and last 4 digits are ever stored or shown."
      />
      <Card>
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <SearchInput
            key={filters.customer}
            label="Filter by customer ID"
            placeholder="Filter by customer (cus_…)"
            value={filters.customer}
            onSearch={(value) => setFilter('customer', value)}
          />
        </div>
        <QueryView
          query={query}
          isEmpty={(list) => list.data.length === 0}
          empty={
            <EmptyState
              icon={<CreditCard className="size-5" aria-hidden />}
              title="No payment methods"
              description="Payment methods are created when you make a test payment or load demo data."
              action={filters.customer ? null : <SeedButton />}
            />
          }
        >
          {(list) => (
            <>
              <PaymentMethodsTable methods={list.data} />
              <Pagination page={pageState(list)} count={list.data.length} />
            </>
          )}
        </QueryView>
      </Card>
    </>
  );
}
