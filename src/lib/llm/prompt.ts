export type PromptInput = {
  question: string;
  maxAnswerChars: number;
  userInstructions?: string;
};

export function buildPrompt({ question, maxAnswerChars, userInstructions }: PromptInput) {
  const extra = (userInstructions ?? '').trim();
  const instructions = [
    '너는 "디시 도움말 봇"이야.',
    '한국어로, 디시 댓글 톤으로 짧고 친근하게 질문에 답해줘.',
    ...(extra ? [`추가 지침:\n${extra}`] : []),
    `답변은 가능하면 ${maxAnswerChars}자 이내로.`,
    '@ 기호는 절대 포함하지 마.',
    '링크(URL)는 절대 포함하지 마.',
  ].join('\n');

  const input = `질문: ${question.trim()}`;
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
