import type { Charge, PaymentIntent } from '@localstripe/contracts';
import { StatusBadge } from '../../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import {
  CardBrand,
  Dash,
  DescriptionList,
  IdLabel,
  Money,
  RelativeTime,
} from '../../components/ui/Display';
import { QueryView } from '../../components/ui/QueryView';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/States';
import { humanize } from '../../lib/status';
import { RefundsTable } from '../refunds/RefundsTable';
import { useRefunds } from '../refunds/api';
import { usePaymentMethod } from './api';
import type { UseQueryResult } from '@tanstack/react-query';

export function PaymentSummaryPanel({ payment }: { payment: PaymentIntent }) {
  return (
    <Card>
      <CardHeader title="Summary" />
      <CardBody className="py-1">
        <DescriptionList
          items={[
            {
              label: 'Amount',
              value: <Money amount={payment.amount} currency={payment.currency} />,
            },
            {
              label: 'Amount received',
              value: <Money amount={payment.amount_received} currency={payment.currency} />,
            },
            { label: 'Status', value: <StatusBadge status={payment.status} /> },
            {
              label: 'Customer',
              value: payment.customer ? (
                <IdLabel id={payment.customer} to={`/customers/${payment.customer}`} />
              ) : (
                <Dash />
              ),
            },
            { label: 'Description', value: payment.description ?? <Dash /> },
            { label: 'Receipt email', value: payment.receipt_email ?? <Dash /> },
            { label: 'Created', value: <RelativeTime timestamp={payment.created} /> },
            ...(payment.canceled_at
              ? [
                  { label: 'Canceled', value: <RelativeTime timestamp={payment.canceled_at} /> },
                  {
                    label: 'Cancellation reason',
                    value: payment.cancellation_reason ? (
                      humanize(payment.cancellation_reason)
                    ) : (
                      <Dash />
                    ),
                  },
                ]
              : []),
            {
              label: 'Metadata',
              value:
                Object.keys(payment.metadata).length > 0 ? (
                  <ul className="space-y-0.5 font-mono text-xs">
                    {Object.entries(payment.metadata).map(([key, value]) => (
                      <li key={key}>
                        {key}: {value}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Dash />
                ),
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}

export function PaymentMethodPanel({ paymentMethodId }: { paymentMethodId: string | null }) {
  const query = usePaymentMethod(paymentMethodId);
  return (
    <Card>
      <CardHeader title="Payment method" />
      <CardBody className="py-1">
        {paymentMethodId ? (
          <QueryView query={query} skeleton={<SkeletonBlock lines={3} />}>
            {(method) => (
              <DescriptionList
                items={[
                  { label: 'ID', value: <IdLabel id={method.id} /> },
                  {
                    label: 'Card',
                    value: <CardBrand brand={method.card.brand} last4={method.card.last4} />,
                  },
                  {
                    label: 'Expires',
                    value: `${String(method.card.exp_month).padStart(2, '0')} / ${method.card.exp_year}`,
                  },
                  { label: 'Funding', value: humanize(method.card.funding) },
                  { label: 'Country', value: method.card.country ?? <Dash /> },
                ]}
              />
            )}
          </QueryView>
        ) : (
          <p className="py-3 text-sm text-zinc-600 dark:text-zinc-400">
            No payment method attached.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export function ChargePanel({ query }: { query: UseQueryResult<Charge> | null }) {
  return (
    <Card>
      <CardHeader title="Latest charge" />
      <CardBody className="py-1">
        {query ? (
          <QueryView query={query} skeleton={<SkeletonBlock lines={4} />}>
            {(charge) => (
              <DescriptionList
                items={[
                  { label: 'ID', value: <IdLabel id={charge.id} /> },
                  { label: 'Status', value: <StatusBadge status={charge.status} /> },
                  {
                    label: 'Amount',
                    value: <Money amount={charge.amount} currency={charge.currency} />,
                  },
                  {
                    label: 'Refunded',
                    value: <Money amount={charge.amount_refunded} currency={charge.currency} />,
                  },
                  { label: 'Outcome', value: charge.outcome.seller_message },
                  ...(charge.failure_message
                    ? [
                        {
                          label: 'Failure',
                          value: `${charge.failure_message} (${charge.failure_code ?? 'n/a'})`,
                        },
                      ]
                    : []),
                  { label: 'Created', value: <RelativeTime timestamp={charge.created} /> },
                ]}
              />
            )}
          </QueryView>
        ) : (
          <p className="py-3 text-sm text-zinc-600 dark:text-zinc-400">
            No charge has been attempted yet.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export function PaymentRefundsPanel({ paymentIntentId }: { paymentIntentId: string }) {
  const query = useRefunds({ payment_intent: paymentIntentId, limit: 100 });
  return (
    <Card>
      <CardHeader title="Refunds" />
      <QueryView
        query={query}
        skeleton={<SkeletonBlock lines={2} />}
        isEmpty={(list) => list.data.length === 0}
        empty={
          <EmptyState title="No refunds" description="Refunds for this payment will appear here." />
        }
      >
        {(list) => <RefundsTable refunds={list.data} showPayment={false} />}
      </QueryView>
    </Card>
  );
}
