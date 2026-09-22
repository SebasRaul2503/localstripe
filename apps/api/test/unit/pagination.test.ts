import { describe, expect, it } from 'vitest';
import { type PageRequest, paginate } from '../../src/shared/pagination.js';

const IDS = Array.from({ length: 25 }, (_, index) => `obj_${String(index).padStart(3, '0')}`);

/** An in-memory stand-in for the keyset query each service runs. */
const fakeFetch = async ({
  cursor,
  order,
  take,
}: {
  cursor?: { op: '<' | '>'; id: string };
  order: 'asc' | 'desc';
  take: number;
}) => {
  const filtered = IDS.filter((id) =>
    !cursor ? true : cursor.op === '<' ? id < cursor.id : id > cursor.id,
  );
  const sorted = order === 'asc' ? filtered : [...filtered].reverse();
  return sorted.slice(0, take);
};

const page = (request: PageRequest) =>
  paginate('/v1/things', request, fakeFetch, (id: string) => ({ id }));
const ids = (list: { data: { id: string }[] }) => list.data.map((item) => item.id);

describe('paginate', () => {
  it('returns the newest items first with has_more', async () => {
    const result = await page({ limit: 10 });
    expect(result.object).toBe('list');
    expect(result.url).toBe('/v1/things');
    expect(ids(result)).toEqual(IDS.slice(15).reverse());
    expect(result.has_more).toBe(true);
  });

  it('continues after starting_after', async () => {
    const result = await page({ limit: 10, startingAfter: 'obj_015' });
    expect(ids(result)).toEqual(IDS.slice(5, 15).reverse());
    expect(result.has_more).toBe(true);
  });

  it('reports the last page', async () => {
    const result = await page({ limit: 10, startingAfter: 'obj_005' });
    expect(ids(result)).toEqual(IDS.slice(0, 5).reverse());
    expect(result.has_more).toBe(false);
  });

  it('pages backwards with ending_before, still newest first', async () => {
    const result = await page({ limit: 3, endingBefore: 'obj_010' });
    expect(ids(result)).toEqual(['obj_013', 'obj_012', 'obj_011']);
    expect(result.has_more).toBe(true);
  });

  it('reports no more items before the newest one', async () => {
    const result = await page({ limit: 10, endingBefore: 'obj_020' });
    expect(ids(result)).toEqual(['obj_024', 'obj_023', 'obj_022', 'obj_021']);
    expect(result.has_more).toBe(false);
  });

  it('handles exactly limit items without has_more', async () => {
    const result = await page({ limit: 25 });
    expect(result.data).toHaveLength(25);
    expect(result.has_more).toBe(false);
  });

  it('prefers starting_after when both cursors are given', async () => {
    const result = await page({ limit: 2, startingAfter: 'obj_010', endingBefore: 'obj_020' });
    expect(ids(result)).toEqual(['obj_009', 'obj_008']);
  });
});
