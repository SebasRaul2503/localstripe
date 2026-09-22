import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export class Metrics {
  readonly registry = new Registry();

  readonly httpRequests = new Counter({
    name: 'localstripe_http_requests_total',
    help: 'HTTP requests handled, by method, route and status code.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpDuration = new Histogram({
    name: 'localstripe_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly paymentOutcomes = new Counter({
    name: 'localstripe_payment_outcomes_total',
    help: 'Simulated payment outcomes (succeeded, declined, requires_action, processing, canceled).',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  readonly webhookAttempts = new Counter({
    name: 'localstripe_webhook_attempts_total',
    help: 'Webhook delivery attempts, by result.',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  constructor(options: { collectDefaults?: boolean } = {}) {
    if (options.collectDefaults)
      collectDefaultMetrics({ register: this.registry, prefix: 'localstripe_' });
  }
}
