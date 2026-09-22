import { sql } from 'kysely';
import type { Executor } from '../../infrastructure/database.js';

/** Ids of the enabled endpoints subscribed to an event type (directly or via `*`). */
export async function subscribedEndpointIds(
  executor: Executor,
  eventType: string,
): Promise<string[]> {
  const rows = await executor
    .selectFrom('webhookEndpoints')
    .select('id')
    .where('status', '=', 'enabled')
    .where('deletedAt', 'is', null)
    .where((eb) =>
      eb.or([
        sql<boolean>`'*' = ANY(${eb.ref('enabledEvents')})`,
        sql<boolean>`${eventType} = ANY(${eb.ref('enabledEvents')})`,
      ]),
    )
    .execute();
  return rows.map((row) => row.id);
}
