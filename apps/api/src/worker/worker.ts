import type { Logger } from 'pino';
import type { Config } from '../config/config.js';
import type { Services } from '../app/services.js';
import { SYSTEM_ORIGIN } from '../shared/context.js';
import type { Job } from './job-queue.js';

const MAINTENANCE_INTERVAL_MS = 60_000;

/**
 * Background processing: settles `processing` payments, delivers webhooks and runs periodic
 * maintenance. All work is claimed from Postgres, so several workers can run side by side.
 */
export class Worker {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  /** Set by stop(), so a standalone tick() (not started) still drains the whole backlog. */
  private stopRequested = false;
  private lastMaintenance = 0;
  private lastTickAt = Date.now();

  /** The loop is considered stuck if no pass has finished for a while (e.g. database outage). */
  isHealthy(): boolean {
    return (
      !this.stopped &&
      Date.now() - this.lastTickAt < Math.max(30_000, this.config.worker.pollIntervalMs * 10)
    );
  }

  constructor(
    private readonly services: Services,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.stopped = false;
    this.stopRequested = false;
    this.schedule(0);
    this.logger.info({ pollIntervalMs: this.config.worker.pollIntervalMs }, 'worker started');
  }

  private schedule(delayMs: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick()
        .then(() => {
          this.lastTickAt = Date.now();
        })
        .catch((error: unknown) => this.logger.error({ err: error }, 'worker tick failed'))
        .finally(() => this.schedule(this.config.worker.pollIntervalMs));
    }, delayMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopRequested = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** Runs one full processing pass. Exposed for tests. */
  async tick(): Promise<void> {
    await this.runJobs();
    while ((await this.services.webhookDispatcher.dispatchDue()) > 0 && !this.stopRequested) {
      // Keep draining while there is a backlog.
    }
    if (Date.now() - this.lastMaintenance >= MAINTENANCE_INTERVAL_MS) {
      this.lastMaintenance = Date.now();
      await this.maintenance();
    }
  }

  private async runJobs() {
    const jobs = await this.services.jobs.claimDue(20, 60_000);
    for (const job of jobs) {
      try {
        await this.handle(job);
        await this.services.jobs.complete(job.id);
      } catch (error) {
        const dropped = await this.services.jobs.fail(job, (error as Error).message);
        this.logger.error({ err: error, jobId: job.id, jobType: job.type, dropped }, 'job failed');
      }
    }
  }

  private async handle(job: Job) {
    switch (job.type) {
      case 'payment_intent.settle': {
        const paymentIntentId = String(job.payload['payment_intent']);
        const result = await this.services.paymentIntents.settle(paymentIntentId, SYSTEM_ORIGIN);
        this.logger.info(
          { paymentIntentId, status: result?.status ?? 'unchanged' },
          'processing payment settled',
        );
        return;
      }
      default:
        throw new Error(`Unknown job type: ${String(job.type)}`);
    }
  }

  async maintenance(): Promise<void> {
    const expired = await this.services.checkoutSessions.expireDue(SYSTEM_ORIGIN);
    const purged = await this.services.idempotency.purgeOlderThan(this.config.idempotency.ttlHours);
    if (expired || purged)
      this.logger.info(
        { expiredCheckoutSessions: expired, purgedIdempotencyKeys: purged },
        'maintenance',
      );
  }
}
