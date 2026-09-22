import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import type { Customer } from '@localstripe/contracts';
import { Alert } from '../../components/ui/Alert';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Dash, DescriptionList, IdLabel, RelativeTime } from '../../components/ui/Display';
import { JsonViewer } from '../../components/ui/JsonViewer';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryView } from '../../components/ui/QueryView';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/toast';
import { PaymentMethodsTable } from '../payment-methods/PaymentMethodsTable';
import { usePaymentIntents } from '../payments/api';
import { CreatePaymentDialog } from '../payments/CreatePaymentDialog';
import { PaymentsTable } from '../payments/PaymentsTable';
import { useCustomer, useCustomerPaymentMethods, useDeleteCustomer } from './api';

function CustomerPayments({ customerId }: { customerId: string }) {
  const query = usePaymentIntents({ customer: customerId, limit: 20 });
  return (
    <Card>
      <CardHeader
        title="Payments"
        actions={
          <ButtonLink size="sm" variant="ghost" to={`/payments?customer=${customerId}`}>
            View all
          </ButtonLink>
        }
      />
      <QueryView
        query={query}
        isEmpty={(list) => list.data.length === 0}
        empty={<EmptyState title="No payments for this customer" />}
      >
        {(list) => <PaymentsTable payments={list.data} showCustomer={false} />}
      </QueryView>
    </Card>
  );
}

function CustomerPaymentMethods({ customerId }: { customerId: string }) {
  const query = useCustomerPaymentMethods(customerId);
  return (
    <Card>
      <CardHeader title="Payment methods" />
      <QueryView
        query={query}
        isEmpty={(list) => list.data.length === 0}
        empty={<EmptyState title="No payment methods attached" />}
      >
        {(list) => <PaymentMethodsTable methods={list.data} showCustomer={false} />}
      </QueryView>
    </Card>
  );
}

function CustomerDetail({ customer }: { customer: Customer }) {
  const [dialog, setDialog] = useState<'delete' | 'payment' | null>(null);
  const remove = useDeleteCustomer(customer.id);
  const navigate = useNavigate();
  const notify = useToast();
  const metadata = Object.entries(customer.metadata);

  return (
    <>
      <PageHeader
        back={{ to: '/customers', label: 'Customers' }}
        title={customer.name ?? customer.email ?? 'Unnamed customer'}
        meta={<IdLabel id={customer.id} truncate={false} />}
        actions={
          <>
            <Button
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setDialog('payment')}
            >
              Create test payment
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" aria-hidden />}
              onClick={() => setDialog('delete')}
            >
              Delete
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="py-1">
              <DescriptionList
                items={[
                  { label: 'Email', value: customer.email ?? <Dash /> },
                  { label: 'Name', value: customer.name ?? <Dash /> },
                  { label: 'Phone', value: customer.phone ?? <Dash /> },
                  { label: 'Description', value: customer.description ?? <Dash /> },
                  { label: 'Created', value: <RelativeTime timestamp={customer.created} /> },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Metadata" />
            <CardBody>
              {metadata.length > 0 ? (
                <DescriptionList
                  items={metadata.map(([key, value]) => ({
                    label: key,
                    value: <span className="font-mono text-xs">{value}</span>,
                  }))}
                />
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">No metadata.</p>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <CustomerPayments customerId={customer.id} />
          <CustomerPaymentMethods customerId={customer.id} />
          <Card>
            <CardHeader title="Raw JSON" />
            <CardBody>
              <JsonViewer value={customer} maxHeight="20rem" />
            </CardBody>
          </Card>
        </div>
      </div>
      {dialog === 'payment' ? (
        <CreatePaymentDialog defaultCustomer={customer.id} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'delete' ? (
        <ConfirmDialog
          title="Delete customer?"
          description={`${customer.email ?? customer.id} will be permanently deleted. Existing payments are kept.`}
          confirmLabel="Delete customer"
          danger
          pending={remove.isPending}
          error={remove.error}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            remove.mutate(undefined, {
              onSuccess: () => {
                notify('Customer deleted.');
                void navigate('/customers');
              },
            })
          }
        />
      ) : null}
    </>
  );
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const query = useCustomer(id);
  return (
    <QueryView
      query={query}
      skeleton={<SkeletonBlock lines={8} />}
      errorTitle="Could not load customer"
    >
      {(customer) =>
        'deleted' in customer ? (
          <>
            <PageHeader back={{ to: '/customers', label: 'Customers' }} title="Deleted customer" />
            <Alert tone="info">
              Customer <code className="font-mono">{customer.id}</code> has been deleted.
            </Alert>
          </>
        ) : (
          <CustomerDetail customer={customer} />
        )
      }
    </QueryView>
  );
}
