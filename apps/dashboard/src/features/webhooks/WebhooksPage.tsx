import { useState } from 'react';
import { Send } from 'lucide-react';
import { WEBHOOK_DELIVERY_STATUSES, type WebhookDeliveryStatus } from '@localstripe/contracts';
import { Card, CardHeader } from '../../components/ui/Card';
import { FilterTabs } from '../../components/ui/FilterTabs';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pagination } from '../../components/ui/Pagination';
import { QueryView } from '../../components/ui/QueryView';
import { EmptyState } from '../../components/ui/States';
import { useListParams } from '../../hooks/useListParams';
import { useWebhookDeliveries } from './api';
import { DeliveriesTable } from './DeliveriesTable';
import { DeliveryDetailDialog } from './DeliveryDetailDialog';
import { EndpointsCard } from './EndpointsCard';

const FILTERS = ['status'] as const;

export function WebhooksPage() {
  const { filters, setFilter, cursor, pageState } = useListParams(FILTERS);
  const [openDelivery, setOpenDelivery] = useState<string | null>(null);
  const query = useWebhookDeliveries({
    ...cursor,
    status: (filters.status || undefined) as WebhookDeliveryStatus | undefined,
  });
  const polling = query.data?.data.some((delivery) => delivery.status === 'pending') ?? false;

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Endpoints that receive signed events, and the delivery log with retries."
      />
      <div className="space-y-6">
        <EndpointsCard />
        <Card>
          <CardHeader
            title="Deliveries"
            description={
              polling
                ? 'Pending deliveries found — refreshing automatically every few seconds.'
                : 'Every attempt to send an event to an endpoint.'
            }
          />
          <FilterTabs
            label="Filter deliveries by status"
            options={WEBHOOK_DELIVERY_STATUSES}
            value={filters.status}
            onChange={(value) => setFilter('status', value)}
          />
          <QueryView
            query={query}
            isEmpty={(list) => list.data.length === 0}
            empty={
              <EmptyState
                icon={<Send className="size-5" aria-hidden />}
                title="No deliveries"
                description="Deliveries appear once an endpoint exists and events are created."
              />
            }
          >
            {(list) => (
              <>
                <DeliveriesTable deliveries={list.data} onOpen={setOpenDelivery} />
                <Pagination page={pageState(list)} count={list.data.length} />
              </>
            )}
          </QueryView>
        </Card>
      </div>
      {openDelivery ? (
        <DeliveryDetailDialog id={openDelivery} onClose={() => setOpenDelivery(null)} />
      ) : null}
    </>
  );
}
