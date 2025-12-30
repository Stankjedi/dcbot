import { describe, expect, it } from 'vitest';
import { clampTextChars, normalizeForComment } from '@/lib/util/text';

describe('text helpers', () => {
  it('normalizes newlines and whitespace for comments', () => {
    const out = normalizeForComment('a  \r\n\r\n\r\n   b\t \n\nc');
    expect(out).toBe('a\n\nb\n\nc');
  });

  it('clamps by character count and appends an ellipsis', () => {
    expect(clampTextChars('hello world', 5)).toBe('hell…');
    expect(clampTextChars('  hi  ', 2)).toBe('hi');
  });
});
