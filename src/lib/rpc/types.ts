import type { Settings } from '@/lib/storage/settings';

export type SearchResult = {
  num: string;
  title: string;
  url: string;
  name?: string;
  date?: string;
};

export type GenerateAnswerInput = {
  commentId: string;
  question: string;
  mode?: 'qa' | 'summary';
  pageUrl?: string;
  pageGalleryId?: string;
  pageIsMgallery?: boolean;
  postTitle?: string;
  postBodyText?: string;
  recentComments?: string[];
};

export type GenerateAnswerResult = {
  answer: string;
  searchResults?: SearchResult[];
  cached?: boolean;
};

export type DcbotHealth = { ok: true; version: string } | { ok: false; error: string };

export type DcbotRpc = {
  health(): Promise<DcbotHealth>;

  getSettings(): Promise<Settings>;
  setSettings(partial: Partial<Settings>): Promise<Settings>;

  getSecretKey(): Promise<string | null>;
  setSecretKey(key: string): Promise<void>;
  clearSecretKey(): Promise<void>;
  testApi(
    model?: string,
  ): Promise<
    | { ok: true; provider: 'openai_direct'; apiType: 'responses' | 'chat_completions' }
    | { ok: true; provider: 'google_gemini' }
    | { ok: false; error: string }
  >;

  getLastError(): Promise<string | null>;
  getErrorLog(): Promise<import('@/lib/storage/localState').ErrorLogEntry[]>;
  logError(entry: import('@/lib/storage/localState').ErrorLogEntry): Promise<void>;
  clearErrorLog(): Promise<void>;

  dcSearch(keyword: string, limit?: number): Promise<SearchResult[]>;
  generateAnswer(input: GenerateAnswerInput): Promise<GenerateAnswerResult>;

  markCommentHandled(commentId: string): Promise<void>;
};
