import { describe, expect, it } from 'vitest';
import { fnv1a32Hex } from '@/lib/util/hash';

describe('fnv1a32Hex', () => {
  it('returns stable 8-char hex', () => {
    expect(fnv1a32Hex('hello')).toBe('4f9f2cab');
    expect(fnv1a32Hex('test')).toBe('afd071e5');
    expect(fnv1a32Hex('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

