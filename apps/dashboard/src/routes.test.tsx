// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ToastProvider } from './components/ui/toast';
import { createQueryClient } from './lib/query';
import { routes } from './routes';

const emptyList = { object: 'list', data: [], has_more: false, url: '/v1/x' };
const stats = {
  object: 'stats',
  payment_intents: { total: 3, by_status: { succeeded: 2 }, failed: 1 },
  volume: [{ currency: 'jpy', succeeded_amount: 1500, refunded_amount: 0 }],
  customers: 1,
  refunds: 0,
  events: 4,
  webhook_deliveries: { pending: 0, succeeded: 1, failed: 0 },
};

function respond(url: string): Response {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (url === '/config.json') return json({ apiUrl: 'http://api', docsUrl: 'http://api/docs' });
  if (url.startsWith('/api/v1/localstripe/stats')) return json(stats);
  if (url.startsWith('/api/v1/localstripe/config')) {
    return json({
      object: 'localstripe_config',
      version: '0.1.0',
      public_api_url: 'http://api',
      strict_params: true,
      payments: {
        global_delay_ms: 0,
        scenario_delays_ms: {},
        max_delay_ms: 1000,
        custom_catalog: false,
      },
      webhooks: { max_attempts: 5, retry_base_delay_ms: 1000, timeout_ms: 1000 },
      checkout: { session_ttl_minutes: 60 },
    });
  }
  if (/\/(pi|cus|evt|cs|re|ch|pm|we|wd)_[A-Za-z0-9_]+$/.test(url.split('?')[0] ?? '')) {
    return json({ error: { type: 'invalid_request_error', message: 'No such object' } }, 404);
  }
  return json(emptyList);
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => respond(String(input))),
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  HTMLDialogElement.prototype.showModal ??= vi.fn();
  HTMLDialogElement.prototype.close ??= vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('dashboard routes', () => {
  it('always shows the test-mode banner and renders overview stats', async () => {
    renderAt('/');
    expect(
      screen.getByText('Test mode — LocalStripe is a mock. No real payments are processed.'),
    ).toBeTruthy();
    expect(await screen.findByText('Total payments')).toBeTruthy();
    expect(await screen.findByText('¥1,500')).toBeTruthy();
  });

  it.each([
    ['/payments', 'No payments yet'],
    ['/customers', 'No customers yet'],
    ['/payment-methods', 'No payment methods'],
    ['/refunds', 'No refunds'],
    ['/checkout-sessions', 'No Checkout Sessions yet'],
    ['/events', 'No events yet'],
    ['/webhooks', 'No webhook endpoints'],
    ['/api-keys', 'No API keys'],
    ['/test-cards', 'The test card catalog is empty'],
    ['/settings', 'Webhook max attempts'],
    ['/checkout/success?session_id=cs_1', 'Thanks — checkout complete!'],
    ['/nope', 'Page not found'],
  ])('renders %s', async (path, text) => {
    renderAt(path);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it.each(['/payments/pi_missing', '/customers/cus_missing', '/events/evt_missing'])(
    'shows an error state with Retry for %s',
    async (path) => {
      renderAt(path);
      expect(await screen.findByText('This object does not exist (or was deleted).')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    },
  );
});
