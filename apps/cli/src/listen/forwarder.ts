import { randomBytes } from 'node:crypto';
import { LocalStripe, type List, type LocalStripeEvent } from '@localstripe/sdk';

export interface EventSource {
  list(params: {
    limit: number;
    created: { gte: number };
    starting_after?: string;
  }): Promise<List<LocalStripeEvent>>;
}

export interface ForwardResult {
  event: LocalStripeEvent;
  status?: number;
  error?: string;
  durationMs: number;
}

export interface ForwarderOptions {
  events: EventSource;
  forwardTo: string;
  secret: string;
  /** Event types to forward; empty or `['*']` forwards everything. */
  eventTypes?: string[];
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/**
 * Events are polled with a `created[gte]` window rather than an id cursor: the window overlaps
 * previous polls by a few seconds and ids already seen are skipped, so events whose transaction
 * committed slightly out of order are not lost. The first window starts a minute in the past
 * (and marks everything in it as seen) to tolerate clock skew between the CLI and the API.
 */
const WINDOW_OVERLAP_SECONDS = 5;
const INITIAL_LOOKBACK_SECONDS = 60;
const PAGE_SIZE = 100;

export const generateWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

export class EventForwarder {
  private readonly seen = new Map<string, number>();
  private windowStart = 0;
  private started = false;
  private readonly filter: Set<string> | null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: ForwarderOptions) {
    const types = options.eventTypes ?? [];
    this.filter = types.length === 0 || types.includes('*') ? null : new Set(types);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Marks the events that already exist as seen, so only new ones are forwarded. */
  async start(): Promise<void> {
    this.windowStart = this.now() - INITIAL_LOOKBACK_SECONDS;
    for (const event of await this.fetchWindow()) this.markSeen(event);
    this.started = true;
  }

  /** Fetches new events and forwards them oldest first. */
  async poll(onResult: (result: ForwardResult) => void, signal?: AbortSignal): Promise<void> {
    if (!this.started) await this.start();
    const fresh = (await this.fetchWindow())
      .filter((event) => !this.seen.has(event.id))
      .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
    for (const event of fresh) {
      if (signal?.aborted) return;
      this.markSeen(event);
      if (this.filter && !this.filter.has(event.type)) continue;
      onResult(await this.forward(event));
    }
    this.advanceWindow();
  }

  async forward(event: LocalStripeEvent): Promise<ForwardResult> {
    const payload = JSON.stringify(event);
    const signature = LocalStripe.webhooks.generateTestHeaderString({
      payload,
      secret: this.options.secret,
      timestamp: this.now(),
    });
    const started = performance.now();
    try {
      const response = await this.fetchImpl(this.options.forwardTo, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'user-agent': 'LocalStripe-CLI/listen',
          'localstripe-signature': signature,
          'stripe-signature': signature,
          'localstripe-event-id': event.id,
        },
        body: payload,
      });
      await response.body?.cancel();
      return { event, status: response.status, durationMs: elapsed(started) };
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      const message = cause instanceof Error ? cause.message : String(cause);
      return { event, error: message, durationMs: elapsed(started) };
    }
  }

  private async fetchWindow(): Promise<LocalStripeEvent[]> {
    const events: LocalStripeEvent[] = [];
    let startingAfter: string | undefined;
    for (;;) {
      const page = await this.options.events.list({
        limit: PAGE_SIZE,
        created: { gte: this.windowStart },
        ...(startingAfter && { starting_after: startingAfter }),
      });
      events.push(...page.data);
      const last = page.data.at(-1);
      if (!page.has_more || !last) return events;
      startingAfter = last.id;
    }
  }

  private markSeen(event: LocalStripeEvent) {
    this.seen.set(event.id, event.created);
  }

  private advanceWindow() {
    const newest = Math.max(this.windowStart, ...this.seen.values());
    this.windowStart = Math.max(this.windowStart, newest - WINDOW_OVERLAP_SECONDS);
    for (const [id, created] of this.seen) {
      if (created < this.windowStart) this.seen.delete(id);
    }
  }
}

const elapsed = (started: number) => Math.round(performance.now() - started);
