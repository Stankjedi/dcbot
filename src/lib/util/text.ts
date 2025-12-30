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

export function stripUrls(text: string): string {
  return text
    .replace(/\bhttps?:\/\/[^\s<>]+/gi, '')
    .replace(/\bwww\.[^\s<>]+/gi, '')
    .replace(/\b(?:gall|m)\.dcinside\.com\/[^\s<>]+/gi, '');
}
