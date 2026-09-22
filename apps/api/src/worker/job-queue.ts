import { sql } from 'kysely';
import type { Db, Executor } from '../infrastructure/database.js';
import { json } from '../infrastructure/database.js';
import { newId } from '../shared/ids.js';

export type JobType = 'payment_intent.settle';

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
}

const MAX_JOB_ATTEMPTS = 10;

/**
 * A durable job queue on top of Postgres. Jobs survive restarts, and `FOR UPDATE SKIP LOCKED`
 * with a lease lets several worker processes share the queue without double-processing.
 */
export class JobQueue {
  constructor(private readonly db: Db) {}

  async enqueue(executor: Executor, type: JobType, payload: Record<string, unknown>, runAt: Date) {
    await executor
      .insertInto('jobs')
      .values({ id: newId('job'), type, payload: json(payload), runAt })
      .execute();
  }

  async claimDue(limit: number, leaseMs: number): Promise<Job[]> {
    const rows = await sql<{
      id: string;
      type: JobType;
      payload: Record<string, unknown>;
      attempts: number;
    }>`
      UPDATE jobs
      SET locked_until = now() + ${`${leaseMs} milliseconds`}::interval, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM jobs
        WHERE run_at <= now() AND (locked_until IS NULL OR locked_until < now())
        ORDER BY run_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload, attempts
    `.execute(this.db);
    return rows.rows;
  }

  async complete(id: string) {
    await this.db.deleteFrom('jobs').where('id', '=', id).execute();
  }

  /** Reschedules with exponential backoff; gives up after MAX_JOB_ATTEMPTS. Returns true if dropped. */
  async fail(job: Job, error: string): Promise<boolean> {
    if (job.attempts >= MAX_JOB_ATTEMPTS) {
      await this.complete(job.id);
      return true;
    }
    const backoffMs = Math.min(1000 * 2 ** job.attempts, 5 * 60_000);
    await this.db
      .updateTable('jobs')
      .set({
        runAt: new Date(Date.now() + backoffMs),
        lockedUntil: null,
        lastError: error.slice(0, 2000),
      })
      .where('id', '=', job.id)
      .execute();
    return false;
  }

  async pendingCount(): Promise<number> {
    const row = await this.db
      .selectFrom('jobs')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }
}
