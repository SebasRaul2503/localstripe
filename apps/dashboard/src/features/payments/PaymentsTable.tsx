import { Link } from 'react-router';
import type { PaymentIntent } from '@localstripe/contracts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Dash, IdLabel, Money, RelativeTime } from '../../components/ui/Display';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';

export function PaymentStatus({ payment }: { payment: PaymentIntent }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge status={payment.status} />
      {payment.last_payment_error && payment.status === 'requires_payment_method' ? (
        <Badge tone="danger">Declined</Badge>
      ) : null}
    </span>
  );
}

export function PaymentsTable({
  payments,
  showCustomer = true,
}: {
  payments: PaymentIntent[];
  showCustomer?: boolean;
}) {
  return (
    <Table label="Payments">
      <THead>
        <TH>Amount</TH>
        <TH>Status</TH>
        <TH>ID</TH>
        {showCustomer ? <TH>Customer</TH> : null}
        <TH className="text-right">Created</TH>
      </THead>
      <TBody>
        {payments.map((payment) => (
          <TR key={payment.id}>
            <TD>
              <Link
                to={`/payments/${payment.id}`}
                className="font-medium hover:underline"
                aria-label={`Payment ${payment.id}`}
              >
                <Money amount={payment.amount} currency={payment.currency} />
                <span className="ml-1.5 text-xs text-zinc-500 uppercase dark:text-zinc-400">
                  {payment.currency}
                </span>
              </Link>
            </TD>
            <TD>
              <PaymentStatus payment={payment} />
            </TD>
            <TD>
              <IdLabel id={payment.id} to={`/payments/${payment.id}`} />
            </TD>
            {showCustomer ? (
              <TD>
                {payment.customer ? (
                  <IdLabel id={payment.customer} to={`/customers/${payment.customer}`} />
                ) : (
                  <Dash />
                )}
              </TD>
            ) : null}
            <TD className="text-right text-zinc-600 dark:text-zinc-400">
              <RelativeTime timestamp={payment.created} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
