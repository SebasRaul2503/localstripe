import { useParams } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { IdLabel, Money } from '../../components/ui/Display';
import { JsonViewer } from '../../components/ui/JsonViewer';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryView } from '../../components/ui/QueryView';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { EventTimeline } from '../events/EventTimeline';
import { useRefunds } from '../refunds/api';
import { useCharge, usePaymentIntent } from './api';
import { PaymentActions } from './PaymentActions';
import {
  ChargePanel,
  PaymentMethodPanel,
  PaymentRefundsPanel,
  PaymentSummaryPanel,
} from './PaymentPanels';
import { PaymentStatus } from './PaymentsTable';
import type { PaymentIntent } from '@localstripe/contracts';

function PaymentDetail({ payment }: { payment: PaymentIntent }) {
  const charge = useCharge(payment.latest_charge);
  const refunds = useRefunds({ payment_intent: payment.id, limit: 100 });
  const refundIds = refunds.data?.data.map((refund) => refund.id) ?? [];
  const refundable = charge.data ? charge.data.amount_captured - charge.data.amount_refunded : null;
  const error = payment.last_payment_error;
  const redirectUrl = payment.next_action?.redirect_to_url.url;

  return (
    <>
      <PageHeader
        back={{ to: '/payments', label: 'Payments' }}
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            <Money amount={payment.amount} currency={payment.currency} />
            <span className="text-base font-normal text-zinc-500 uppercase">
              {payment.currency}
            </span>
          </span>
        }
        meta={
          <>
            <PaymentStatus payment={payment} />
            <IdLabel id={payment.id} truncate={false} />
          </>
        }
        actions={<PaymentActions payment={payment} refundable={refundable} />}
      />

      <div className="space-y-4">
        {payment.status === 'requires_action' && redirectUrl ? (
          <Alert tone="warning" title="3D Secure authentication required">
            <p>
              The customer must complete the simulated challenge. Use the buttons above, or open the{' '}
              <a
                href={redirectUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium underline"
              >
                hosted 3DS page
                <ExternalLink className="size-3" aria-hidden />
              </a>
              .
            </p>
          </Alert>
        ) : null}
        {error ? (
          <Alert tone="danger" title="Last payment error">
            <p>{error.message}</p>
            <p className="mt-1 font-mono text-xs">
              type={error.type} code={error.code ?? 'null'} decline_code=
              {error.decline_code ?? 'null'}
            </p>
          </Alert>
        ) : null}
        {refundable !== null && charge.data && charge.data.amount_refunded > 0 ? (
          <Alert tone="info">
            Refunded <Money amount={charge.data.amount_refunded} currency={payment.currency} /> —{' '}
            <Money amount={refundable} currency={payment.currency} /> remaining refundable.
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <PaymentSummaryPanel payment={payment} />
            <div className="grid gap-4 md:grid-cols-2">
              <PaymentMethodPanel paymentMethodId={payment.payment_method} />
              <ChargePanel query={payment.latest_charge ? charge : null} />
            </div>
            <PaymentRefundsPanel paymentIntentId={payment.id} />
          </div>
          <Card className="self-start">
            <CardHeader title="Events" description="Payment, charge and refund events." />
            <CardBody>
              <EventTimeline
                objectIds={[
                  payment.id,
                  ...(payment.latest_charge ? [payment.latest_charge] : []),
                  ...refundIds,
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Raw JSON" />
          <CardBody>
            <JsonViewer value={payment} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

export function PaymentDetailPage() {
  const { id = '' } = useParams();
  const query = usePaymentIntent(id);
  return (
    <QueryView
      query={query}
      skeleton={<SkeletonBlock lines={8} />}
      errorTitle="Could not load payment"
    >
      {(payment) => <PaymentDetail payment={payment} />}
    </QueryView>
  );
}
