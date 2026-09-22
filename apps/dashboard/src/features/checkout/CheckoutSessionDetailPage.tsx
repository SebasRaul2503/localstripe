import { useState } from 'react';
import { useParams } from 'react-router';
import { ExternalLink, TimerOff } from 'lucide-react';
import type { CheckoutSession } from '@localstripe/contracts';
import { StatusBadge } from '../../components/ui/Badge';
import { Button, buttonClasses } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Dash, DescriptionList, IdLabel, Money, RelativeTime } from '../../components/ui/Display';
import { JsonViewer } from '../../components/ui/JsonViewer';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryView } from '../../components/ui/QueryView';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { useToast } from '../../components/ui/toast';
import { EventTimeline } from '../events/EventTimeline';
import { useCheckoutLineItems, useCheckoutSession, useExpireCheckoutSession } from './api';

function LineItems({ sessionId }: { sessionId: string }) {
  const query = useCheckoutLineItems(sessionId);
  return (
    <Card>
      <CardHeader title="Line items" />
      <QueryView query={query} skeleton={<SkeletonBlock lines={2} />}>
        {(list) => (
          <Table label="Line items">
            <THead>
              <TH>Item</TH>
              <TH className="text-right">Unit price</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Total</TH>
            </THead>
            <TBody>
              {list.data.map((item) => (
                <TR key={item.id}>
                  <TD className="font-medium">{item.description}</TD>
                  <TD className="text-right">
                    <Money amount={item.price.unit_amount} currency={item.currency} />
                  </TD>
                  <TD className="text-right tabular-nums">{item.quantity}</TD>
                  <TD className="text-right font-medium">
                    <Money amount={item.amount_total} currency={item.currency} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryView>
    </Card>
  );
}

function SessionDetail({ session }: { session: CheckoutSession }) {
  const [confirming, setConfirming] = useState(false);
  const expire = useExpireCheckoutSession(session.id);
  const notify = useToast();

  return (
    <>
      <PageHeader
        back={{ to: '/checkout-sessions', label: 'Checkout sessions' }}
        title={<Money amount={session.amount_total} currency={session.currency} />}
        meta={
          <>
            <StatusBadge status={session.status} />
            <StatusBadge status={session.payment_status} />
            <IdLabel id={session.id} truncate={false} />
          </>
        }
        actions={
          <>
            {session.url && session.status === 'open' ? (
              <a
                href={session.url}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses('primary')}
              >
                <ExternalLink className="size-4" aria-hidden />
                Open hosted checkout
              </a>
            ) : null}
            {session.status === 'open' ? (
              <Button
                variant="danger"
                icon={<TimerOff className="size-4" aria-hidden />}
                onClick={() => setConfirming(true)}
              >
                Expire
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="py-1">
              <DescriptionList
                items={[
                  { label: 'Status', value: <StatusBadge status={session.status} /> },
                  {
                    label: 'Payment status',
                    value: <StatusBadge status={session.payment_status} />,
                  },
                  {
                    label: 'Payment intent',
                    value: session.payment_intent ? (
                      <IdLabel
                        id={session.payment_intent}
                        to={`/payments/${session.payment_intent}`}
                      />
                    ) : (
                      <Dash />
                    ),
                  },
                  {
                    label: 'Customer',
                    value: session.customer ? (
                      <IdLabel id={session.customer} to={`/customers/${session.customer}`} />
                    ) : (
                      (session.customer_email ?? <Dash />)
                    ),
                  },
                  {
                    label: 'Hosted URL',
                    value: session.url ? (
                      <span className="font-mono text-xs break-all">{session.url}</span>
                    ) : (
                      <Dash />
                    ),
                  },
                  {
                    label: 'Success URL',
                    value: (
                      <span className="font-mono text-xs break-all">{session.success_url}</span>
                    ),
                  },
                  {
                    label: 'Cancel URL',
                    value: session.cancel_url ? (
                      <span className="font-mono text-xs break-all">{session.cancel_url}</span>
                    ) : (
                      <Dash />
                    ),
                  },
                  { label: 'Created', value: <RelativeTime timestamp={session.created} /> },
                  { label: 'Expires', value: <RelativeTime timestamp={session.expires_at} /> },
                ]}
              />
            </CardBody>
          </Card>
          <LineItems sessionId={session.id} />
          <Card>
            <CardHeader title="Raw JSON" />
            <CardBody>
              <JsonViewer value={session} />
            </CardBody>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader title="Events" />
          <CardBody>
            <EventTimeline objectIds={[session.id]} />
          </CardBody>
        </Card>
      </div>
      {confirming ? (
        <ConfirmDialog
          title="Expire this session?"
          description="Customers will no longer be able to pay it."
          confirmLabel="Expire session"
          danger
          pending={expire.isPending}
          error={expire.error}
          onClose={() => setConfirming(false)}
          onConfirm={() =>
            expire.mutate(undefined, {
              onSuccess: () => {
                notify('Checkout Session expired.');
                setConfirming(false);
              },
            })
          }
        />
      ) : null}
    </>
  );
}

export function CheckoutSessionDetailPage() {
  const { id = '' } = useParams();
  const query = useCheckoutSession(id);
  return (
    <QueryView
      query={query}
      skeleton={<SkeletonBlock lines={8} />}
      errorTitle="Could not load session"
    >
      {(session) => <SessionDetail session={session} />}
    </QueryView>
  );
}
