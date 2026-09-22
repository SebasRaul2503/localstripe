import type { PaymentMethod } from '@localstripe/contracts';
import { CardBrand, Dash, IdLabel, RelativeTime } from '../../components/ui/Display';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { humanize } from '../../lib/status';

export function PaymentMethodsTable({
  methods,
  showCustomer = true,
}: {
  methods: PaymentMethod[];
  showCustomer?: boolean;
}) {
  return (
    <Table label="Payment methods">
      <THead>
        <TH>Card</TH>
        <TH>Expires</TH>
        <TH>Funding</TH>
        <TH>ID</TH>
        {showCustomer ? <TH>Customer</TH> : null}
        <TH className="text-right">Created</TH>
      </THead>
      <TBody>
        {methods.map((method) => (
          <TR key={method.id}>
            <TD>
              <CardBrand brand={method.card.brand} last4={method.card.last4} />
            </TD>
            <TD className="tabular-nums">
              {String(method.card.exp_month).padStart(2, '0')}/{method.card.exp_year}
            </TD>
            <TD>{humanize(method.card.funding)}</TD>
            <TD>
              <IdLabel id={method.id} />
            </TD>
            {showCustomer ? (
              <TD>
                {method.customer ? (
                  <IdLabel id={method.customer} to={`/customers/${method.customer}`} />
                ) : (
                  <Dash />
                )}
              </TD>
            ) : null}
            <TD className="text-right text-zinc-600 dark:text-zinc-400">
              <RelativeTime timestamp={method.created} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
