export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

export function parseUrlWithHttpFallback(input: string): URL | null {
  const raw = input.trim();
  if (raw.length === 0) return null;

  try {
    return new URL(raw);
  } catch {
    // fall through
  }

  if (!raw.includes('://')) {
    try {
      return new URL(`http://${raw}`);
    } catch {
      // ignore
    }
  }

  return null;
}

export function toHostPermissionPattern(url: URL): string | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.trim();
  if (host.length === 0) return null;

  const alreadyBracketed = host.startsWith('[') && host.endsWith(']');
  const needsBrackets = host.includes(':') && !alreadyBracketed;
  const hostPart = needsBrackets ? `[${host}]` : host;
  return `${url.protocol}//${hostPart}/*`;
}
