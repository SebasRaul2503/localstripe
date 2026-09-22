import { useState } from 'react';
import { Link } from 'react-router';
import { Plus, ShoppingCart } from 'lucide-react';
import { CHECKOUT_SESSION_STATUSES, type CheckoutSessionStatus } from '@localstripe/contracts';
import { StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dash, IdLabel, Money, RelativeTime } from '../../components/ui/Display';
import { FilterTabs } from '../../components/ui/FilterTabs';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pagination } from '../../components/ui/Pagination';
import { QueryView } from '../../components/ui/QueryView';
import { EmptyState } from '../../components/ui/States';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { useListParams } from '../../hooks/useListParams';
import { useCheckoutSessions } from './api';
import { CreateCheckoutDialog } from './CreateCheckoutDialog';

const FILTERS = ['status'] as const;

export function CheckoutSessionsPage() {
  const { filters, setFilter, cursor, pageState } = useListParams(FILTERS);
  const [creating, setCreating] = useState(false);
  const query = useCheckoutSessions({
    ...cursor,
    status: (filters.status || undefined) as CheckoutSessionStatus | undefined,
  });

  return (
    <>
      <PageHeader
        title="Checkout sessions"
        description="Hosted payment pages. Open a session's URL to pay it with a test card."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => setCreating(true)}
          >
            Create session
          </Button>
        }
      />
      <Card>
        <FilterTabs
          label="Filter by status"
          options={CHECKOUT_SESSION_STATUSES}
          value={filters.status}
          onChange={(value) => setFilter('status', value)}
        />
        <QueryView
          query={query}
          isEmpty={(list) => list.data.length === 0}
          empty={
            <EmptyState
              icon={<ShoppingCart className="size-5" aria-hidden />}
              title={filters.status ? 'No sessions with this status' : 'No Checkout Sessions yet'}
              description="Create a session and open its hosted page to simulate a checkout."
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create session
                </Button>
              }
            />
          }
        >
          {(list) => (
            <>
              <Table label="Checkout sessions">
                <THead>
                  <TH>Amount</TH>
                  <TH>Status</TH>
                  <TH>Payment</TH>
                  <TH>ID</TH>
                  <TH>Customer email</TH>
                  <TH className="text-right">Created</TH>
                </THead>
                <TBody>
                  {list.data.map((session) => (
                    <TR key={session.id}>
                      <TD className="font-medium">
                        <Link to={`/checkout-sessions/${session.id}`} className="hover:underline">
                          <Money amount={session.amount_total} currency={session.currency} />
                        </Link>
                      </TD>
                      <TD>
                        <StatusBadge status={session.status} />
                      </TD>
                      <TD>
                        <StatusBadge status={session.payment_status} />
                      </TD>
                      <TD>
                        <IdLabel id={session.id} to={`/checkout-sessions/${session.id}`} />
                      </TD>
                      <TD>{session.customer_email ?? <Dash />}</TD>
                      <TD className="text-right text-zinc-600 dark:text-zinc-400">
                        <RelativeTime timestamp={session.created} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination page={pageState(list)} count={list.data.length} />
            </>
          )}
        </QueryView>
      </Card>
      {creating ? <CreateCheckoutDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
