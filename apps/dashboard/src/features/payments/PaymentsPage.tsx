import { useState } from 'react';
import { Plus, Wallet } from 'lucide-react';
import { PAYMENT_INTENT_STATUSES, type PaymentIntentStatus } from '@localstripe/contracts';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FilterTabs } from '../../components/ui/FilterTabs';
import { GoToIdForm } from '../../components/ui/GoToIdForm';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pagination } from '../../components/ui/Pagination';
import { QueryView } from '../../components/ui/QueryView';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/States';
import { useListParams } from '../../hooks/useListParams';
import { SeedButton } from '../settings/SeedButton';
import { usePaymentIntents } from './api';
import { CreatePaymentDialog } from './CreatePaymentDialog';
import { PaymentsTable } from './PaymentsTable';

const FILTERS = ['status', 'customer'] as const;

export function PaymentsPage() {
  const { filters, setFilter, cursor, pageState } = useListParams(FILTERS);
  const [creating, setCreating] = useState(false);
  const query = usePaymentIntents({
    ...cursor,
    status: (filters.status || undefined) as PaymentIntentStatus | undefined,
    customer: filters.customer || undefined,
  });
  const filtered = Boolean(filters.status || filters.customer);

  return (
    <>
      <PageHeader
        title="Payments"
        description="PaymentIntents created through the API, Checkout or this dashboard."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => setCreating(true)}
          >
            Create test payment
          </Button>
        }
      />
      <Card>
        <FilterTabs
          label="Filter by status"
          options={PAYMENT_INTENT_STATUSES}
          value={filters.status}
          onChange={(value) => setFilter('status', value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <SearchInput
            key={filters.customer}
            label="Filter by customer ID"
            placeholder="Filter by customer (cus_…)"
            value={filters.customer}
            onSearch={(value) => setFilter('customer', value)}
          />
          <GoToIdForm basePath="/payments" label="Go to payment ID" placeholder="pi_…" />
        </div>
        <QueryView
          query={query}
          isEmpty={(list) => list.data.length === 0}
          empty={
            <EmptyState
              icon={<Wallet className="size-5" aria-hidden />}
              title={filtered ? 'No payments match these filters' : 'No payments yet'}
              description={
                filtered
                  ? 'Try another status or clear the customer filter.'
                  : 'Create a test payment with one of the test cards, or load demo data.'
              }
              action={
                <>
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    Create a test payment
                  </Button>
                  {filtered ? null : <SeedButton />}
                </>
              }
            />
          }
        >
          {(list) => (
            <>
              <PaymentsTable payments={list.data} />
              <Pagination page={pageState(list)} count={list.data.length} />
            </>
          )}
        </QueryView>
      </Card>
      {creating ? <CreatePaymentDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
