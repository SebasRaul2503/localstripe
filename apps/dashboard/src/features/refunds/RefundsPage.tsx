import { RotateCcw } from 'lucide-react';
import { ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pagination } from '../../components/ui/Pagination';
import { QueryView } from '../../components/ui/QueryView';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/States';
import { useListParams } from '../../hooks/useListParams';
import { useRefunds } from './api';
import { RefundsTable } from './RefundsTable';

const FILTERS = ['payment_intent'] as const;

export function RefundsPage() {
  const { filters, setFilter, cursor, pageState } = useListParams(FILTERS);
  const query = useRefunds({ ...cursor, payment_intent: filters.payment_intent || undefined });

  return (
    <>
      <PageHeader
        title="Refunds"
        description="Refunds are created from a succeeded payment's detail page."
      />
      <Card>
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <SearchInput
            key={filters.payment_intent}
            label="Filter by payment ID"
            placeholder="Filter by payment (pi_…)"
            value={filters.payment_intent}
            onSearch={(value) => setFilter('payment_intent', value)}
          />
        </div>
        <QueryView
          query={query}
          isEmpty={(list) => list.data.length === 0}
          empty={
            <EmptyState
              icon={<RotateCcw className="size-5" aria-hidden />}
              title="No refunds"
              description="Open a succeeded payment and use Refund to create one."
              action={
                <ButtonLink variant="primary" to="/payments?status=succeeded">
                  View succeeded payments
                </ButtonLink>
              }
            />
          }
        >
          {(list) => (
            <>
              <RefundsTable refunds={list.data} />
              <Pagination page={pageState(list)} count={list.data.length} />
            </>
          )}
        </QueryView>
      </Card>
    </>
  );
}
