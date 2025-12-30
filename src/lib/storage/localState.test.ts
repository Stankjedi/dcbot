import { describe, expect, it } from 'vitest';
import { pruneHandledMap } from '@/lib/storage/localState';

describe('pruneHandledMap', () => {
  it('keeps only the newest N entries', () => {
    const map = {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    };
    const pruned = pruneHandledMap(map, 2);
    expect(Object.keys(pruned).sort()).toEqual(['c', 'd']);
  });

  it('returns a copy when under the limit', () => {
    const map = { a: 1, b: 2 };
    const pruned = pruneHandledMap(map, 10);
    expect(pruned).toEqual(map);
    expect(pruned).not.toBe(map);
  });
});

