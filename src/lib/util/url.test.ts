import { describe, expect, it } from 'vitest';
import { isLoopbackHostname, parseUrlWithHttpFallback, toHostPermissionPattern } from '@/lib/util/url';

describe('url utils', () => {
  it('detects loopback hostnames', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('LOCALHOST')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);

    expect(isLoopbackHostname('127.0.0.2')).toBe(false);
    expect(isLoopbackHostname('example.com')).toBe(false);
  });

  it('parses urls with http fallback', () => {
    expect(parseUrlWithHttpFallback('http://127.0.0.1:8787')?.hostname).toBe('127.0.0.1');
    expect(parseUrlWithHttpFallback('127.0.0.1:8787')?.protocol).toBe('http:');
    expect(parseUrlWithHttpFallback('not a url')).toBe(null);
  });

  it('builds host permission patterns', () => {
    const u1 = new URL('https://api.openai.com/v1');
    expect(toHostPermissionPattern(u1)).toBe('https://api.openai.com/*');

    const u2 = new URL('http://127.0.0.1:8787/');
    expect(toHostPermissionPattern(u2)).toBe('http://127.0.0.1/*');

    const u3 = new URL('http://[::1]:8787/');
    expect(toHostPermissionPattern(u3)).toBe('http://[::1]/*');
  });
});
