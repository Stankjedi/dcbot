import { describe, expect, it } from 'vitest';
import { buildPrompt, buildSummaryPrompt } from '@/lib/llm/prompt';

describe('buildPrompt', () => {
  it('includes question and core constraints', () => {
    const { instructions, input } = buildPrompt({
      question: '1 더하기 1?',
      maxAnswerChars: 800,
    });
    expect(instructions).toContain('디시봇:');
    expect(instructions).toContain('@ 기호는 절대 포함하지 마.');
    expect(instructions).toContain('포털 검색');
    expect(input).toContain('질문: 1 더하기 1?');
    expect(input).not.toContain('https://');
  });

  it('includes user instructions when provided', () => {
    const { instructions } = buildPrompt({
      question: '안녕',
      maxAnswerChars: 120,
      userInstructions: '반말로 짧게',
    });
    expect(instructions).toContain('추가 지침');
    expect(instructions).toContain('반말로 짧게');
    expect(instructions).toContain('@ 기호는 절대 포함하지 마.');
    expect(instructions).toContain('링크(URL)는 포털 검색 링크 1개만 허용해.');
  });
});

describe('buildSummaryPrompt', () => {
  it('includes title/body/comments and request when provided', () => {
    const { instructions, input } = buildSummaryPrompt({
      postTitle: '제목',
      postBodyText: '본문 일부',
      recentComments: ['댓글1', '댓글2'],
      request: '한줄로',
      maxAnswerChars: 200,
    });

    expect(instructions).toContain('디시봇:');
    expect(instructions).toContain('@ 기호는 절대 포함하지 마.');
    expect(instructions).toContain('포털 검색');

    expect(input).toContain('요약 요청: 한줄로');
    expect(input).toContain('글 제목: 제목');
    expect(input).toContain('글 본문(일부):');
    expect(input).toContain('댓글(일부):');
    expect(input).toContain('1) 댓글1');
    expect(input).toContain('2) 댓글2');
  });
});
