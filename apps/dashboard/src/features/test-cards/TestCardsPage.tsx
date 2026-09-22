import { StatusBadge } from '../../components/ui/Badge';
import { Alert } from '../../components/ui/Alert';
import { Card } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { Dash } from '../../components/ui/Display';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryView } from '../../components/ui/QueryView';
import { EmptyState } from '../../components/ui/States';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { humanize } from '../../lib/status';
import { useTestCards } from './api';

const SCENARIO_STATUS: Record<string, string> = {
  succeeded: 'succeeded',
  declined: 'declined',
  requires_action: 'requires_action',
  processing: 'processing',
};

function formatCardNumber(number: string) {
  return number.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function TestCardsPage() {
  const query = useTestCards();
  return (
    <>
      <PageHeader
        title="Test cards"
        description="Use any future expiry date and any 3-digit CVC."
      />
      <Alert tone="warning" className="mb-4" title="Only these card numbers are accepted">
        LocalStripe never contacts a card network. Any other number is rejected with{' '}
        <code>incorrect_number</code>. Tokens such as <code>pm_card_visa</code> can be used directly
        as <code>payment_method</code>.
      </Alert>
      <Card>
        <QueryView
          query={query}
          isEmpty={(list) => list.data.length === 0}
          empty={<EmptyState title="The test card catalog is empty" />}
        >
          {(list) => (
            <Table label="Test cards">
              <THead>
                <TH>Card</TH>
                <TH>Number</TH>
                <TH>Scenario</TH>
                <TH>Decline code</TH>
                <TH>Token</TH>
                <TH>Description</TH>
              </THead>
              <TBody>
                {list.data.map((card) => (
                  <TR key={card.id}>
                    <TD className="font-medium">
                      {card.label}
                      <p className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                        {humanize(card.brand)} · {card.funding}
                      </p>
                    </TD>
                    <TD>
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <code className="font-mono text-xs">{formatCardNumber(card.number)}</code>
                        <CopyButton value={card.number} label="Copy card number" />
                      </span>
                    </TD>
                    <TD>
                      <StatusBadge
                        status={SCENARIO_STATUS[card.scenario] ?? card.scenario}
                        label={humanize(card.scenario)}
                      />
                      {card.settles_to ? (
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          settles to {card.settles_to}
                          {card.delay_ms ? ` after ${card.delay_ms / 1000}s` : ''}
                        </p>
                      ) : null}
                    </TD>
                    <TD className="font-mono text-xs">
                      {card.decline_code ?? card.error_code ?? <Dash />}
                    </TD>
                    <TD>
                      {card.payment_method_token ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          <code className="font-mono text-xs">{card.payment_method_token}</code>
                          <CopyButton value={card.payment_method_token} label="Copy token" />
                        </span>
                      ) : (
                        <Dash />
                      )}
                    </TD>
                    <TD className="min-w-[14rem] text-zinc-600 dark:text-zinc-400">
                      {card.description}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryView>
      </Card>
    </>
  );
}
