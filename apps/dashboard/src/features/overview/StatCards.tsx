import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Stats } from '@localstripe/contracts';
import { Card, CardHeader } from '../../components/ui/Card';
import { Money } from '../../components/ui/Display';
import { Skeleton } from '../../components/ui/Skeleton';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';

function Stat({
  label,
  value,
  to,
  hint,
}: {
  label: string;
  value: ReactNode;
  to?: string;
  hint?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p> : null}
    </>
  );
  const classes =
    'block rounded-lg border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900';
  return to ? (
    <Link to={to} className={`${classes} hover:border-indigo-300 dark:hover:border-indigo-700`}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export function StatCardsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading statistics"
      className="grid grid-cols-2 gap-3 md:grid-cols-4"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-12" />
        </div>
      ))}
    </div>
  );
}

export function StatCards({ stats }: { stats: Stats }) {
  const byStatus = stats.payment_intents.by_status;
  const count = (status: string) => byStatus[status] ?? 0;
  const hooks = stats.webhook_deliveries;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total payments" value={stats.payment_intents.total} to="/payments" />
        <Stat label="Succeeded" value={count('succeeded')} to="/payments?status=succeeded" />
        <Stat label="Failed" value={stats.payment_intents.failed} hint="Declined or failed 3DS" />
        <Stat label="Processing" value={count('processing')} to="/payments?status=processing" />
        <Stat
          label="Requires action"
          value={count('requires_action')}
          to="/payments?status=requires_action"
        />
        <Stat label="Refunds" value={stats.refunds} to="/refunds" />
        <Stat label="Customers" value={stats.customers} to="/customers" />
        <Stat label="Events" value={stats.events} to="/events" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Webhook deliveries" />
          <div className="grid grid-cols-3 divide-x divide-zinc-200 dark:divide-zinc-800">
            {(
              [
                ['Pending', hooks.pending, 'pending'],
                ['Succeeded', hooks.succeeded, 'succeeded'],
                ['Failed', hooks.failed, 'failed'],
              ] as const
            ).map(([label, value, status]) => (
              <Link
                key={status}
                to={`/webhooks?status=${status}`}
                className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
              >
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Volume by currency" />
          {stats.volume.length === 0 ? (
            <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
              No successful payments yet.
            </p>
          ) : (
            <Table label="Volume by currency">
              <THead>
                <TH>Currency</TH>
                <TH className="text-right">Succeeded</TH>
                <TH className="text-right">Refunded</TH>
              </THead>
              <TBody>
                {stats.volume.map((row) => (
                  <TR key={row.currency}>
                    <TD className="font-medium uppercase">{row.currency}</TD>
                    <TD className="text-right">
                      <Money amount={row.succeeded_amount} currency={row.currency} />
                    </TD>
                    <TD className="text-right text-zinc-600 dark:text-zinc-400">
                      <Money amount={row.refunded_amount} currency={row.currency} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
