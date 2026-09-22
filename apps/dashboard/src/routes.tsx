import type { RouteObject } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { ApiKeysPage } from './features/api-keys/ApiKeysPage';
import { CheckoutResultPage } from './features/checkout/CheckoutResultPage';
import { CheckoutSessionDetailPage } from './features/checkout/CheckoutSessionDetailPage';
import { CheckoutSessionsPage } from './features/checkout/CheckoutSessionsPage';
import { CustomerDetailPage } from './features/customers/CustomerDetailPage';
import { CustomersPage } from './features/customers/CustomersPage';
import { EventDetailPage } from './features/events/EventDetailPage';
import { EventsPage } from './features/events/EventsPage';
import { NotFoundPage } from './features/NotFoundPage';
import { OverviewPage } from './features/overview/OverviewPage';
import { PaymentMethodsPage } from './features/payment-methods/PaymentMethodsPage';
import { PaymentDetailPage } from './features/payments/PaymentDetailPage';
import { PaymentsPage } from './features/payments/PaymentsPage';
import { RefundDetailPage } from './features/refunds/RefundDetailPage';
import { RefundsPage } from './features/refunds/RefundsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TestCardsPage } from './features/test-cards/TestCardsPage';
import { WebhooksPage } from './features/webhooks/WebhooksPage';

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'payments', element: <PaymentsPage /> },
      { path: 'payments/:id', element: <PaymentDetailPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'customers/:id', element: <CustomerDetailPage /> },
      { path: 'payment-methods', element: <PaymentMethodsPage /> },
      { path: 'refunds', element: <RefundsPage /> },
      { path: 'refunds/:id', element: <RefundDetailPage /> },
      { path: 'checkout-sessions', element: <CheckoutSessionsPage /> },
      { path: 'checkout-sessions/:id', element: <CheckoutSessionDetailPage /> },
      { path: 'checkout/success', element: <CheckoutResultPage outcome="success" /> },
      { path: 'checkout/cancel', element: <CheckoutResultPage outcome="cancel" /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:id', element: <EventDetailPage /> },
      { path: 'webhooks', element: <WebhooksPage /> },
      { path: 'api-keys', element: <ApiKeysPage /> },
      { path: 'test-cards', element: <TestCardsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
