import { describe, expect, it } from 'vitest';
import { clampTextChars, normalizeForComment, stripUrls } from '@/lib/util/text';

describe('text helpers', () => {
  it('normalizes newlines and whitespace for comments', () => {
    const out = normalizeForComment('a  \r\n\r\n\r\n   b\t \n\nc');
    expect(out).toBe('a\n\nb\n\nc');
  });

  it('clamps by character count and appends an ellipsis', () => {
    expect(clampTextChars('hello world', 5)).toBe('hell…');
    expect(clampTextChars('  hi  ', 2)).toBe('hi');
  });

  it('strips urls from text', () => {
    expect(stripUrls('a https://example.com b')).toBe('a  b');
    expect(stripUrls('a http://example.com b')).toBe('a  b');
    expect(stripUrls('a www.example.com b')).toBe('a  b');
    expect(stripUrls('a gall.dcinside.com/mgallery/board/view?id=x&no=1 b')).toBe('a  b');
  });
});
