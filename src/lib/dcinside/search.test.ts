import { describe, expect, it } from 'vitest';
import { parseSearchResultsFromHtml } from '@/lib/dcinside/search';

describe('parseSearchResultsFromHtml', () => {
  const html = `
    <html><body>
      <table id="kakao_seach_list">
        <tr>
          <td class="gall_num">123</td>
          <td class="gall_tit"><a href="/mgallery/board/view/?id=thesingularity&no=123">제목1</a></td>
          <td class="gall_name">닉네임</td>
          <td class="gall_date">2025-12-28</td>
        </tr>
        <tr>
          <td class="gall_num">124</td>
          <td class="gall_tit"><a href="https://gall.dcinside.com/board/view/?id=thesingularity&no=124">제목2</a></td>
          <td class="gall_name">ㅇㅇ</td>
          <td class="gall_date">2025-12-27</td>
        </tr>
      </table>
    </body></html>
  `;

  it('parses results (DOMParser path)', () => {
    const res = parseSearchResultsFromHtml(html, 5);
    expect(res.length).toBe(2);
    expect(res[0]!.num).toBe('123');
    expect(res[0]!.title).toBe('제목1');
    expect(res[0]!.url).toMatch(/^https:\/\/gall\.dcinside\.com\//);
  });

  it('parses results (regex fallback)', () => {
    const saved = (globalThis as any).DOMParser;
    (globalThis as any).DOMParser = undefined;
    try {
      const res = parseSearchResultsFromHtml(html, 5);
      expect(res.length).toBe(2);
      expect(res[1]!.title).toBe('제목2');
    } finally {
      (globalThis as any).DOMParser = saved;
    }
  });
});

