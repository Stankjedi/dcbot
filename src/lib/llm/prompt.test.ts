import { describe, expect, it } from 'vitest';
import { buildPrompt } from '@/lib/llm/prompt';

describe('buildPrompt', () => {
  it('includes question and core constraints', () => {
    const { instructions, input } = buildPrompt({
      question: '1 더하기 1?',
      maxAnswerChars: 800,
    });
    expect(instructions).toContain('링크');
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
    expect(instructions).toContain('링크(URL)는 절대 포함하지 마.');
  });
});
