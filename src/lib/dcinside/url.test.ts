import { describe, expect, it } from 'vitest';
import { buildDcSearchUrl, encodeDcSearchKeyword } from '@/lib/dcinside/url';

describe('dcinside/url', () => {
  it('encodes keywords with dot-percent style', () => {
    expect(encodeDcSearchKeyword('hello world')).toBe('hello.20world');
  });

  it('builds a search URL with required params', () => {
    const url = buildDcSearchUrl({ galleryId: 'thesingularity', isMgallery: true, keyword: 'hello world' });
    const u = new URL(url);
    expect(u.origin).toBe('https://gall.dcinside.com');
    expect(u.pathname).toContain('/mgallery/board/lists');
    expect(u.searchParams.get('id')).toBe('thesingularity');
    expect(u.searchParams.get('s_type')).toBe('search_subject_memo');
    expect(u.searchParams.get('s_keyword')).toBe('hello.20world');
  });
});

