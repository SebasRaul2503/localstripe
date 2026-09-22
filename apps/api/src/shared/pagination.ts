import { z } from 'zod';
import type { List } from '@localstripe/contracts';
import { integer } from './validation.js';

export const listParamsShape = {
  limit: integer({ min: 1, max: 100 }).default(10),
  starting_after: z.string().max(255).optional(),
  ending_before: z.string().max(255).optional(),
  expand: z.union([z.array(z.string()), z.string()]).optional(),
};

export const listParamsSchema = z.object(listParamsShape);
export type ListParams = z.infer<typeof listParamsSchema>;

export interface PageRequest {
  limit: number;
  startingAfter?: string;
  endingBefore?: string;
}

export const toPageRequest = (params: ListParams): PageRequest => ({
  limit: params.limit,
  startingAfter: params.starting_after,
  endingBefore: params.ending_before,
});

/**
 * Keyset pagination over time-ordered ids, newest first (Stripe semantics).
 * `fetch` receives the cursor condition and must return up to `limit + 1` rows in the given order.
 */
export async function paginate<Row, Resource>(
  url: string,
  page: PageRequest,
  fetch: (args: {
    cursor?: { op: '<' | '>'; id: string };
    order: 'asc' | 'desc';
    take: number;
  }) => Promise<Row[]>,
  toResource: (row: Row) => Resource,
): Promise<List<Resource>> {
  const take = page.limit + 1;
  if (page.endingBefore && !page.startingAfter) {
    const rows = await fetch({ cursor: { op: '>', id: page.endingBefore }, order: 'asc', take });
    const hasMore = rows.length > page.limit;
    const data = rows.slice(0, page.limit).reverse().map(toResource);
    return { object: 'list', data, has_more: hasMore, url };
  }
  const rows = await fetch({
    cursor: page.startingAfter ? { op: '<', id: page.startingAfter } : undefined,
    order: 'desc',
    take,
  });
  return {
    object: 'list',
    data: rows.slice(0, page.limit).map(toResource),
    has_more: rows.length > page.limit,
    url,
  };
}
