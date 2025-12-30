import type { SearchResult } from '@/lib/rpc/types';
import { buildDcSearchUrl } from '@/lib/dcinside/url';

export type DcinsideSearchParams = {
  galleryId: string;
  isMgallery: boolean;
  keyword: string;
  limit: number;
  timeoutMs?: number;
};

function stripTags(html: string) {
  return html.replace(/<[^>]*>/g, '');
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeText(text: string) {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function toAbsoluteUrl(href: string) {
  try {
    return new URL(href, 'https://gall.dcinside.com/').toString();
  } catch {
    return href;
  }
}

export class DcinsideSearchHttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`DCInside search HTTP error (${status})`);
    this.name = 'DcinsideSearchHttpError';
    this.status = status;
  }
}

export class DcinsideSearchTimeoutError extends Error {
  timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`DCInside search timeout (${timeoutMs}ms)`);
    this.name = 'DcinsideSearchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function isAbortError(error: unknown) {
  if (error && typeof error === 'object' && 'name' in error) {
    return (error as any).name === 'AbortError';
  }
  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function parseSearchResultsFromHtml(html: string, limit: number): SearchResult[] {
  const cappedLimit = Math.max(0, Math.min(10, Math.trunc(limit)));
  if (cappedLimit <= 0) return [];

  // Preferred: DOMParser (works in many extension contexts).
  try {
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const table = doc.getElementById('kakao_seach_list');
      if (!table) return [];

      const out: SearchResult[] = [];
      const rows = Array.from(table.querySelectorAll('tr'));
      for (const row of rows) {
        const num = normalizeText(row.querySelector('.gall_num')?.textContent ?? '');
        const titleNode = row.querySelector('.gall_tit');
        const anchor = titleNode?.querySelector('a') ?? row.querySelector('a');
        const href = anchor?.getAttribute('href') ?? '';
        const title = normalizeText(anchor?.textContent ?? '');
        const name = normalizeText(row.querySelector('.gall_name')?.textContent ?? '');
        const date = normalizeText(row.querySelector('.gall_date')?.textContent ?? '');

        if (!title || !href) continue;
        out.push({
          num: num || '',
          title,
          url: toAbsoluteUrl(href),
          name: name || undefined,
          date: date || undefined,
        });
        if (out.length >= cappedLimit) break;
      }
      return out;
    }
  } catch {
    // Fall through to regex parsing.
  }

  // Fallback: very small regex-based parser.
  const tableMatch = html.match(/<table[^>]*id=["']kakao_seach_list["'][^>]*>[\s\S]*?<\/table>/i);
  const tableHtml = tableMatch?.[0] ?? '';
  if (!tableHtml) return [];

  const rows = tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const out: SearchResult[] = [];

  for (const row of rows) {
    const numMatch = row.match(/class=["'][^"']*\bgall_num\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const num = normalizeText(stripTags(numMatch?.[1] ?? ''));

    const titMatch = row.match(/class=["'][^"']*\bgall_tit\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const titHtml = titMatch?.[1] ?? row;
    const aMatch = titHtml.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const href = aMatch?.[1] ?? '';
    const title = normalizeText(stripTags(aMatch?.[2] ?? ''));

    const nameMatch = row.match(/class=["'][^"']*\bgall_name\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const name = normalizeText(stripTags(nameMatch?.[1] ?? ''));

    const dateMatch = row.match(/class=["'][^"']*\bgall_date\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const date = normalizeText(stripTags(dateMatch?.[1] ?? ''));

    if (!title || !href) continue;
    out.push({
      num: num || '',
      title,
      url: toAbsoluteUrl(href),
      name: name || undefined,
      date: date || undefined,
    });
    if (out.length >= cappedLimit) break;
  }

  return out;
}

export async function dcinsideSearch(params: DcinsideSearchParams): Promise<SearchResult[]> {
  const url = buildDcSearchUrl({ galleryId: params.galleryId, isMgallery: params.isMgallery, keyword: params.keyword });
  const timeoutMs = params.timeoutMs ?? 8_000;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, { method: 'GET', credentials: 'omit' }, timeoutMs);
  } catch (error) {
    if (isAbortError(error)) throw new DcinsideSearchTimeoutError(timeoutMs);
    throw error;
  }

  if (!res.ok) throw new DcinsideSearchHttpError(res.status);
  const html = await res.text();
  return parseSearchResultsFromHtml(html, params.limit);
}
