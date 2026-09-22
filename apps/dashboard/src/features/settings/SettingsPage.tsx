import { useState } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DescriptionList } from '../../components/ui/Display';
import { JsonViewer } from '../../components/ui/JsonViewer';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryView } from '../../components/ui/QueryView';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/toast';
import { useAppConfig } from '../../hooks/useAppConfig';
import { humanize } from '../../lib/status';
import { useLocalStripeConfig, useReset } from './api';
import { SeedButton } from './SeedButton';

const ms = (value: number) => (value >= 1000 ? `${value / 1000} s` : `${value} ms`);

function ExternalAnchor({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-indigo-700 hover:underline dark:text-indigo-400"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

export function SettingsPage() {
  const query = useLocalStripeConfig();
  const { apiUrl, docsUrl } = useAppConfig();
  const reset = useReset();
  const notify = useToast();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Runtime configuration of this LocalStripe instance (read-only)."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Runtime configuration" />
          <CardBody className="py-1">
            <QueryView query={query} skeleton={<SkeletonBlock lines={6} />}>
              {(config) => (
                <DescriptionList
                  items={[
                    { label: 'Version', value: config.version },
                    {
                      label: 'Public API URL',
                      value: <code className="text-xs">{config.public_api_url}</code>,
                    },
                    { label: 'Strict parameters', value: config.strict_params ? 'Yes' : 'No' },
                    { label: 'Global delay', value: ms(config.payments.global_delay_ms) },
                    {
                      label: 'Scenario delays',
                      value:
                        Object.entries(config.payments.scenario_delays_ms)
                          .map(([scenario, value]) => `${humanize(scenario)}: ${ms(value)}`)
                          .join(', ') || 'None',
                    },
                    { label: 'Max delay per request', value: ms(config.payments.max_delay_ms) },
                    {
                      label: 'Custom card catalog',
                      value: config.payments.custom_catalog ? 'Yes' : 'No',
                    },
                    { label: 'Webhook max attempts', value: config.webhooks.max_attempts },
                    {
                      label: 'Webhook retry base delay',
                      value: ms(config.webhooks.retry_base_delay_ms),
                    },
                    { label: 'Webhook timeout', value: ms(config.webhooks.timeout_ms) },
                    {
                      label: 'Checkout session TTL',
                      value: `${config.checkout.session_ttl_minutes} min`,
                    },
                  ]}
                />
              )}
            </QueryView>
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="API" />
            <CardBody className="py-1">
              <DescriptionList
                items={[
                  { label: 'Base URL', value: <code className="text-xs">{apiUrl}</code> },
                  {
                    label: 'Reference',
                    value: <ExternalAnchor href={docsUrl}>API docs</ExternalAnchor>,
                  },
                  {
                    label: 'OpenAPI',
                    value: (
                      <ExternalAnchor href={`${apiUrl}/openapi.json`}>openapi.json</ExternalAnchor>
                    ),
                  },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Demo data" />
            <CardBody className="space-y-3">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Creates clearly labelled demo customers and payments in several states.
              </p>
              <SeedButton />
            </CardBody>
          </Card>
          <Card className="border-red-200 dark:border-red-900">
            <CardHeader title="Danger zone" />
            <CardBody className="space-y-3">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Deletes all customers, payments, refunds, Checkout Sessions, events and webhook
                deliveries. API keys and webhook endpoints are kept.
              </p>
              <Button
                variant="danger"
                icon={<Trash2 className="size-4" aria-hidden />}
                onClick={() => setConfirming(true)}
              >
                Reset all data
              </Button>
            </CardBody>
          </Card>
        </div>
        {query.data ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Raw configuration" />
            <CardBody>
              <JsonViewer value={query.data} maxHeight="16rem" />
            </CardBody>
          </Card>
        ) : null}
      </div>
      {confirming ? (
        <ConfirmDialog
          title="Reset all data?"
          description="This permanently deletes all payment data in this LocalStripe instance."
          confirmLabel="Reset all data"
          danger
          typeToConfirm="reset"
          pending={reset.isPending}
          error={reset.error}
          onClose={() => {
            reset.reset();
            setConfirming(false);
          }}
          onConfirm={() =>
            reset.mutate(undefined, {
              onSuccess: () => {
                notify('All payment data was deleted.');
                setConfirming(false);
              },
            })
          }
        >
          <Alert tone="danger">This cannot be undone.</Alert>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
