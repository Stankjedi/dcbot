export type PromptInput = {
  question: string;
  maxAnswerChars: number;
  baseInstructions?: string;
  userInstructions?: string;
};

export const DEFAULT_QA_BASE_INSTRUCTIONS = ['너는 "디시 도움말 봇"이야.', '한국어로, 디시 댓글 톤으로 짧고 친근하게 질문에 답해줘.'].join('\n');

export function buildPrompt({ question, maxAnswerChars, baseInstructions, userInstructions }: PromptInput) {
  const baseText = (baseInstructions ?? DEFAULT_QA_BASE_INSTRUCTIONS).trim() || DEFAULT_QA_BASE_INSTRUCTIONS;
  const extra = (userInstructions ?? '').trim();
  const instructions = [
    baseText,
    ...(extra ? [`추가 지침:\n${extra}`] : []),
    `답변은 가능하면 ${maxAnswerChars}자 이내로.`,
    '답변 첫 줄은 반드시 "디시봇:"으로 시작해.',
    '@ 기호는 절대 포함하지 마.',
    '링크(URL)는 포털 검색 링크 1개만 허용해. (네이버/다음/구글 검색)',
  ].join('\n');

  const input = `질문: ${question.trim()}`;
  return { instructions, input };
}

export type SummaryPromptInput = {
  postTitle?: string;
  postBodyText?: string;
  recentComments?: string[];
  request?: string;
  maxAnswerChars: number;
  baseInstructions?: string;
};

export const DEFAULT_SUMMARY_BASE_INSTRUCTIONS = [
  '너는 "디시 글 요약 봇"이야.',
  '한국어로, 디시 댓글에 붙여넣기 좋게 짧게 요약해.',
  '핵심만 3~6줄로 요약하고, 불필요한 수식은 줄여.',
  '사실이 불확실하면 단정하지 마.',
].join('\n');

export function buildSummaryPrompt({ postTitle, postBodyText, recentComments, request, maxAnswerChars, baseInstructions }: SummaryPromptInput) {
  const baseText = (baseInstructions ?? DEFAULT_SUMMARY_BASE_INSTRUCTIONS).trim() || DEFAULT_SUMMARY_BASE_INSTRUCTIONS;
  const instructions = [
    baseText,
    `요약은 가능하면 ${maxAnswerChars}자 이내로.`,
    '답변 첫 줄은 반드시 "디시봇:"으로 시작해.',
    '@ 기호는 절대 포함하지 마.',
    '링크(URL)는 포털 검색 링크 1개만 허용해. (네이버/다음/구글 검색)',
  ].join('\n');

  const parts: string[] = [];
  parts.push('작업: 아래 글을 짧게 요약해.');

  if (request && request.trim().length > 0) parts.push(`요약 요청: ${request.trim()}`);

  if (postTitle && postTitle.trim().length > 0) parts.push(`글 제목: ${postTitle.trim()}`);
  if (postBodyText && postBodyText.trim().length > 0) parts.push(`글 본문(일부):\n${postBodyText.trim()}`);

  if (recentComments && recentComments.length > 0) {
    const cleaned = recentComments.map((c) => c.trim()).filter((c) => c.length > 0);
    if (cleaned.length > 0) {
      parts.push(`댓글(일부):\n${cleaned.map((c, i) => `${i + 1}) ${c}`).join('\n')}`);
    }
  }

  const input = parts.join('\n\n');
  return { instructions, input };
}
