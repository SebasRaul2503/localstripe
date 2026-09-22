import { useState } from 'react';
import { Link } from 'react-router';
import { Plus, Zap } from 'lucide-react';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { RelativeTime } from '../../components/ui/Display';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryView } from '../../components/ui/QueryView';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/States';
import { useEvents } from '../events/api';
import { usePaymentIntents } from '../payments/api';
import { CreatePaymentDialog } from '../payments/CreatePaymentDialog';
import { PaymentsTable } from '../payments/PaymentsTable';
import { SeedButton } from '../settings/SeedButton';
import { useStats } from './api';
import { StatCards, StatCardsSkeleton } from './StatCards';

function RecentEvents() {
  const query = useEvents({ limit: 8 });
  return (
    <Card>
      <CardHeader
        title="Recent events"
        actions={
          <ButtonLink size="sm" variant="ghost" to="/events">
            View all
          </ButtonLink>
        }
      />
      <QueryView
        query={query}
        skeleton={<SkeletonRows rows={5} columns={2} />}
        isEmpty={(list) => list.data.length === 0}
        empty={<EmptyState icon={<Zap className="size-5" aria-hidden />} title="No events yet" />}
      >
        {(list) => (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {list.data.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Link
                  to={`/events/${event.id}`}
                  className="truncate font-mono text-xs text-indigo-700 hover:underline dark:text-indigo-400"
                >
                  {event.type}
                </Link>
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                  <RelativeTime timestamp={event.created} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Card>
  );
}

function RecentPayments({ onCreate }: { onCreate: () => void }) {
  const query = usePaymentIntents({ limit: 8 });
  return (
    <Card>
      <CardHeader
        title="Recent payments"
        actions={
          <ButtonLink size="sm" variant="ghost" to="/payments">
            View all
          </ButtonLink>
        }
      />
      <QueryView
        query={query}
        isEmpty={(list) => list.data.length === 0}
        empty={
          <EmptyState
            title="No payments yet"
            description="Create a test payment or load demo data to see LocalStripe in action."
            action={
              <>
                <Button variant="primary" onClick={onCreate}>
                  Create a test payment
                </Button>
                <SeedButton />
              </>
            }
          />
        }
      >
        {(list) => <PaymentsTable payments={list.data} />}
      </QueryView>
    </Card>
  );
}

export function OverviewPage() {
  const stats = useStats();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Overview"
        description="A local, fake payment provider for development and tests."
        actions={
          <>
            <SeedButton />
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setCreating(true)}
            >
              Create test payment
            </Button>
          </>
        }
      />
      <div className="space-y-6">
        <QueryView
          query={stats}
          skeleton={<StatCardsSkeleton />}
          errorTitle="Could not load statistics"
        >
          {(data) => <StatCards stats={data} />}
        </QueryView>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentPayments onCreate={() => setCreating(true)} />
          </div>
          <RecentEvents />
        </div>
      </div>
      {creating ? <CreatePaymentDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
