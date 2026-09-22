import type { Refund } from '@localstripe/contracts';
import { StatusBadge } from '../../components/ui/Badge';
import { Dash, IdLabel, Money, RelativeTime } from '../../components/ui/Display';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { humanize } from '../../lib/status';

export function RefundsTable({
  refunds,
  showPayment = true,
}: {
  refunds: Refund[];
  showPayment?: boolean;
}) {
  return (
    <Table label="Refunds">
      <THead>
        <TH>Amount</TH>
        <TH>Status</TH>
        <TH>ID</TH>
        {showPayment ? <TH>Payment</TH> : null}
        <TH>Reason</TH>
        <TH className="text-right">Created</TH>
      </THead>
      <TBody>
        {refunds.map((refund) => (
          <TR key={refund.id}>
            <TD className="font-medium">
              <Money amount={refund.amount} currency={refund.currency} />
            </TD>
            <TD>
              <StatusBadge status={refund.status} />
            </TD>
            <TD>
              <IdLabel id={refund.id} to={`/refunds/${refund.id}`} />
            </TD>
            {showPayment ? (
              <TD>
                <IdLabel id={refund.payment_intent} to={`/payments/${refund.payment_intent}`} />
              </TD>
            ) : null}
            <TD>{refund.reason ? humanize(refund.reason) : <Dash />}</TD>
            <TD className="text-right text-zinc-600 dark:text-zinc-400">
              <RelativeTime timestamp={refund.created} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
