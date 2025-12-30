import { describe, expect, it } from 'vitest';
import { pickContextWindow } from '@/lib/util/context';

describe('pickContextWindow', () => {
  it('picks items before the center and fills with after', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(pickContextWindow(items, 3, 3)).toEqual(['a', 'b', 'c']); // before centerIndex=3 => a,b,c
    expect(pickContextWindow(items, 1, 3)).toEqual(['a', 'c', 'd']); // before=a, fill with after
  });

  it('handles out-of-range center', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(pickContextWindow(items, -1, 2)).toEqual(['c', 'd']);
  });
});

