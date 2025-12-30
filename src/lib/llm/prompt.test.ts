import { describe, expect, it } from 'vitest';
import { buildPrompt } from '@/lib/llm/prompt';

describe('buildPrompt', () => {
  it('includes question and optional context', () => {
    const { instructions, input } = buildPrompt({
      question: '1 더하기 1?',
      postTitle: '제목',
      postBodyText: '본문',
      recentComments: ['댓글1', '댓글2'],
      searchResults: [{ num: '1', title: '글', url: 'https://example.com', date: '2025-12-28', name: 'ㅇㅇ' }],
      maxAnswerChars: 800,
      includeSources: true,
    });
    expect(instructions).toContain('관련 글');
    expect(input).toContain('질문: 1 더하기 1?');
    expect(input).toContain('현재 글 제목: 제목');
    expect(input).toContain('갤러리 검색 결과');
  });
});

