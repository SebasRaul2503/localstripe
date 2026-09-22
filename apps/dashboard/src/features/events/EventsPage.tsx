import { Link } from 'react-router';
import { Zap } from 'lucide-react';
import { EVENT_TYPES } from '@localstripe/contracts';
import { Card } from '../../components/ui/Card';
import { Dash, IdLabel, RelativeTime } from '../../components/ui/Display';
import { Select } from '../../components/ui/Field';
import { GoToIdForm } from '../../components/ui/GoToIdForm';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pagination } from '../../components/ui/Pagination';
import { QueryView } from '../../components/ui/QueryView';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/States';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { useListParams } from '../../hooks/useListParams';
import { SeedButton } from '../settings/SeedButton';
import { objectPath, useEvents } from './api';

const FILTERS = ['type', 'object_id'] as const;

export function EventsPage() {
  const { filters, setFilter, cursor, pageState } = useListParams(FILTERS);
  const query = useEvents({
    ...cursor,
    type: filters.type || undefined,
    object_id: filters.object_id || undefined,
  });
  const filtered = Boolean(filters.type || filters.object_id);

  return (
    <>
      <PageHeader
        title="Events"
        description="Every state change emits an event, which is delivered to matching webhook endpoints."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <Select
            aria-label="Filter by event type"
            value={filters.type}
            onChange={(event) => setFilter('type', event.target.value)}
            className="w-full font-mono text-xs sm:w-72"
          >
            <option value="">All event types</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
          <SearchInput
            key={filters.object_id}
            label="Filter by object ID"
            placeholder="Object ID (pi_…, cus_…)"
            value={filters.object_id}
            onSearch={(value) => setFilter('object_id', value)}
          />
          <div className="sm:ml-auto">
            <GoToIdForm basePath="/events" label="Go to event ID" placeholder="evt_…" />
          </div>
        </div>
        <QueryView
          query={query}
          isEmpty={(list) => list.data.length === 0}
          empty={
            <EmptyState
              icon={<Zap className="size-5" aria-hidden />}
              title={filtered ? 'No events match these filters' : 'No events yet'}
              description="Events are created as customers, payments and refunds change."
              action={filtered ? null : <SeedButton />}
            />
          }
        >
          {(list) => (
            <>
              <Table label="Events">
                <THead>
                  <TH>Type</TH>
                  <TH>Object</TH>
                  <TH>ID</TH>
                  <TH className="text-right">Created</TH>
                </THead>
                <TBody>
                  {list.data.map((event) => {
                    const objectId =
                      typeof event.data.object['id'] === 'string' ? event.data.object['id'] : null;
                    const path = objectPath(event.data.object);
                    return (
                      <TR key={event.id}>
                        <TD>
                          <Link
                            to={`/events/${event.id}`}
                            className="font-mono text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                          >
                            {event.type}
                          </Link>
                        </TD>
                        <TD>
                          {objectId ? (
                            <IdLabel id={objectId} {...(path ? { to: path } : {})} />
                          ) : (
                            <Dash />
                          )}
                        </TD>
                        <TD>
                          <IdLabel id={event.id} to={`/events/${event.id}`} />
                        </TD>
                        <TD className="text-right text-zinc-600 dark:text-zinc-400">
                          <RelativeTime timestamp={event.created} />
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
              <Pagination page={pageState(list)} count={list.data.length} />
            </>
          )}
        </QueryView>
      </Card>
    </>
  );
}
