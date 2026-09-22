import { useParams } from 'react-router';
import { StatusBadge } from '../../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Dash, DescriptionList, IdLabel, Money, RelativeTime } from '../../components/ui/Display';
import { JsonViewer } from '../../components/ui/JsonViewer';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryView } from '../../components/ui/QueryView';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { humanize } from '../../lib/status';
import { EventTimeline } from '../events/EventTimeline';
import { useRefund } from './api';

export function RefundDetailPage() {
  const { id = '' } = useParams();
  const query = useRefund(id);
  return (
    <QueryView
      query={query}
      skeleton={<SkeletonBlock lines={8} />}
      errorTitle="Could not load refund"
    >
      {(refund) => (
        <>
          <PageHeader
            back={{ to: '/refunds', label: 'Refunds' }}
            title={<Money amount={refund.amount} currency={refund.currency} />}
            meta={
              <>
                <StatusBadge status={refund.status} />
                <IdLabel id={refund.id} truncate={false} />
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
                      {
                        label: 'Amount',
                        value: <Money amount={refund.amount} currency={refund.currency} />,
                      },
                      { label: 'Status', value: <StatusBadge status={refund.status} /> },
                      {
                        label: 'Payment',
                        value: (
                          <IdLabel
                            id={refund.payment_intent}
                            to={`/payments/${refund.payment_intent}`}
                          />
                        ),
                      },
                      { label: 'Charge', value: <IdLabel id={refund.charge} /> },
                      {
                        label: 'Reason',
                        value: refund.reason ? humanize(refund.reason) : <Dash />,
                      },
                      { label: 'Created', value: <RelativeTime timestamp={refund.created} /> },
                    ]}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Raw JSON" />
                <CardBody>
                  <JsonViewer value={refund} />
                </CardBody>
              </Card>
            </div>
            <Card className="self-start">
              <CardHeader title="Events" />
              <CardBody>
                <EventTimeline objectIds={[refund.id]} />
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </QueryView>
  );
}
