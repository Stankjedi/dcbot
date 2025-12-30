import type { SearchResult } from '@/lib/rpc/types';

export type PromptInput = {
  question: string;
  postTitle?: string;
  postBodyText?: string;
  recentComments?: string[];
  searchResults?: SearchResult[];
  maxAnswerChars: number;
  includeSources: boolean;
};

export function buildPrompt({ question, postTitle, postBodyText, recentComments, searchResults, maxAnswerChars, includeSources }: PromptInput) {
  const instructions = [
    '너는 "디시 도움말 봇"이야.',
    '한국어로, 디시 댓글에 어울리게 짧고 명확하게 답해.',
    '모르면 모른다고 말하고, 확인이 필요한 내용은 단정하지 마.',
    `답변은 가능하면 ${maxAnswerChars}자 이내로.`,
    includeSources ? '가능하면 마지막에 "관련 글:"로 1~3개 링크를 제시해.' : '불필요한 링크는 넣지 마.',
  ].join('\n');

  const parts: string[] = [];
  parts.push(`질문: ${question.trim()}`);

  if (postTitle && postTitle.trim().length > 0) parts.push(`현재 글 제목: ${postTitle.trim()}`);
  if (postBodyText && postBodyText.trim().length > 0) parts.push(`현재 글 본문(일부):\n${postBodyText.trim()}`);

  if (recentComments && recentComments.length > 0) {
    const clipped = recentComments
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (clipped.length > 0) parts.push(`최근 댓글(일부):\n- ${clipped.join('\n- ')}`);
  }

  if (searchResults && searchResults.length > 0) {
    const top = searchResults.slice(0, 5);
    parts.push(
      [
        '갤러리 검색 결과(참고):',
        ...top.map((r, i) => {
          const meta = [r.date, r.name].filter(Boolean).join(' / ');
          const metaText = meta.length > 0 ? ` (${meta})` : '';
          return `${i + 1}) ${r.title}${metaText} - ${r.url}`;
        }),
      ].join('\n'),
    );
  }

  const input = parts.join('\n\n');
  return { instructions, input };
}

export type SummaryPromptInput = {
  postTitle?: string;
  postBodyText?: string;
  maxAnswerChars: number;
};

export function buildSummaryPrompt({ postTitle, postBodyText, maxAnswerChars }: SummaryPromptInput) {
  const instructions = [
    '너는 "디시 글 요약 봇"이야.',
    '한국어로, 디시 댓글에 붙여넣기 좋게 짧게 요약해.',
    '핵심만 3~6줄로 요약하고, 불필요한 수식은 줄여.',
    '사실이 불확실하면 단정하지 마.',
    `요약은 가능하면 ${maxAnswerChars}자 이내로.`,
  ].join('\n');

  const parts: string[] = [];
  parts.push('작업: 아래 글을 짧게 요약해.');

  if (postTitle && postTitle.trim().length > 0) parts.push(`글 제목: ${postTitle.trim()}`);
  if (postBodyText && postBodyText.trim().length > 0) parts.push(`글 본문(일부):\n${postBodyText.trim()}`);

  const input = parts.join('\n\n');
  return { instructions, input };
}
