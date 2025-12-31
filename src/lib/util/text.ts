export function clampTextChars(text: string, maxChars: number): string {
  const cleaned = text.trim();
  if (maxChars <= 0) return cleaned;
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function normalizeForComment(text: string): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized;
}

export type StripUrlOptions = {
  allowPortalSearchLink?: boolean;
  maxAllowedPortalSearchLinks?: number;
};

function isAllowedPortalSearchUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    const isNaver = (host === 'search.naver.com' || host.endsWith('.search.naver.com')) && path.includes('search');
    const isDaum = (host === 'search.daum.net' || host.endsWith('.search.daum.net')) && path.startsWith('/search');
    const isGoogle = (host === 'google.com' || host.endsWith('.google.com')) && path.startsWith('/search');

    return isNaver || isDaum || isGoogle;
  } catch {
    return false;
  }
}

export function stripUrls(text: string, options?: StripUrlOptions): string {
  const allowPortalSearchLink = options?.allowPortalSearchLink === true;
  const maxAllowedPortalSearchLinks = Math.max(0, Math.trunc(options?.maxAllowedPortalSearchLinks ?? 1));

  if (!allowPortalSearchLink || maxAllowedPortalSearchLinks === 0) {
    return text
      .replace(/\bhttps?:\/\/[^\s<>]+/gi, '')
      .replace(/\bwww\.[^\s<>]+/gi, '')
      .replace(/\b(?:gall|m)\.dcinside\.com\/[^\s<>]+/gi, '');
  }

  const kept: string[] = [];
  let out = text.replace(/\bhttps?:\/\/[^\s<>]+/gi, (match) => {
    if (kept.length >= maxAllowedPortalSearchLinks) return '';
    if (!isAllowedPortalSearchUrl(match)) return '';
    const token = `__DCBOT_URL_${kept.length}__`;
    kept.push(match);
    return token;
  });

  out = out.replace(/\bwww\.[^\s<>]+/gi, (match) => {
    if (kept.length >= maxAllowedPortalSearchLinks) return '';
    if (!isAllowedPortalSearchUrl(`https://${match}`)) return '';
    const token = `__DCBOT_URL_${kept.length}__`;
    kept.push(match);
    return token;
  });

  out = out.replace(/\b(?:gall|m)\.dcinside\.com\/[^\s<>]+/gi, '');

  for (let i = 0; i < kept.length; i++) {
    out = out.replace(new RegExp(`__DCBOT_URL_${i}__`, 'g'), kept[i]!);
  }
  return out;
}
