import { useState } from 'react';
import { Link } from 'react-router';
import { Plus, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dash, IdLabel, RelativeTime } from '../../components/ui/Display';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pagination } from '../../components/ui/Pagination';
import { QueryView } from '../../components/ui/QueryView';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/States';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { useListParams } from '../../hooks/useListParams';
import { SeedButton } from '../settings/SeedButton';
import { useCustomers } from './api';
import { CreateCustomerDialog } from './CreateCustomerDialog';

const FILTERS = ['query'] as const;

export function CustomersPage() {
  const { filters, setFilter, cursor, pageState } = useListParams(FILTERS);
  const [creating, setCreating] = useState(false);
  const query = useCustomers({ ...cursor, query: filters.query || undefined });

  return (
    <>
      <PageHeader
        title="Customers"
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => setCreating(true)}
          >
            Create customer
          </Button>
        }
      />
      <Card>
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <SearchInput
            key={filters.query}
            label="Search customers"
            placeholder="Search by email, name or ID"
            value={filters.query}
            onSearch={(value) => setFilter('query', value)}
          />
        </div>
        <QueryView
          query={query}
          isEmpty={(list) => list.data.length === 0}
          empty={
            <EmptyState
              icon={<Users className="size-5" aria-hidden />}
              title={filters.query ? `No customers match “${filters.query}”` : 'No customers yet'}
              description={
                filters.query
                  ? 'Search matches email, name or customer ID.'
                  : 'Create a customer or load demo data to get started.'
              }
              action={
                <>
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    Create customer
                  </Button>
                  {filters.query ? null : <SeedButton />}
                </>
              }
            />
          }
        >
          {(list) => (
            <>
              <Table label="Customers">
                <THead>
                  <TH>Customer</TH>
                  <TH>Email</TH>
                  <TH>ID</TH>
                  <TH className="text-right">Created</TH>
                </THead>
                <TBody>
                  {list.data.map((customer) => (
                    <TR key={customer.id}>
                      <TD className="font-medium">
                        <Link to={`/customers/${customer.id}`} className="hover:underline">
                          {customer.name ?? customer.email ?? 'Unnamed customer'}
                        </Link>
                      </TD>
                      <TD>{customer.email ?? <Dash />}</TD>
                      <TD>
                        <IdLabel id={customer.id} to={`/customers/${customer.id}`} />
                      </TD>
                      <TD className="text-right text-zinc-600 dark:text-zinc-400">
                        <RelativeTime timestamp={customer.created} />
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
      {creating ? <CreateCustomerDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
