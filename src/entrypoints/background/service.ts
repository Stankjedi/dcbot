import { callLocalProxyAnswer } from '@/lib/llm/localProxy';
import { callGeminiGenerateContent, GeminiApiError } from '@/lib/llm/googleGemini';
import { callOpenAiChatCompletions, callOpenAiResponses, OpenAiApiError } from '@/lib/llm/openaiResponses';
import { buildPrompt, buildSummaryPrompt } from '@/lib/llm/prompt';
import type { DcbotRpc, GenerateAnswerInput, GenerateAnswerResult, SearchResult } from '@/lib/rpc/types';
import { DcinsideSearchHttpError, DcinsideSearchTimeoutError, dcinsideSearch } from '@/lib/dcinside/search';
import { getDirectApiKey, setDirectApiKey, clearDirectApiKey, getLocalProxyToken } from '@/lib/storage/secrets';
import { getSettings, setSettings } from '@/lib/storage/settings';
import { appendErrorLog, clearErrorLog, getErrorLog, getLastError, isCommentHandled, markCommentHandled } from '@/lib/storage/localState';
import type { ErrorLogEntry } from '@/lib/storage/localState';
import { sha256Hex } from '@/lib/util/hash';
import { clampTextChars, normalizeForComment } from '@/lib/util/text';
import { isLoopbackHostname, parseUrlWithHttpFallback } from '@/lib/util/url';

type CacheEntry = {
  answer: string;
  ts: number;
  searchResults?: SearchResult[];
};

const CACHE_TTL_MS = 120_000;
const RATE_LIMIT_WINDOW_MS = 60_000;

function now() {
  return Date.now();
}

function buildRelatedLinks(results: SearchResult[], limit: number) {
  const top = results.slice(0, limit);
  if (top.length === 0) return '';
  const lines = ['관련 글:', ...top.map((r, i) => `${i + 1}) ${r.title} - ${r.url}`)];
  return `\n\n${lines.join('\n')}`;
}

function extractKeyword(question: string) {
  const cleaned = question
    .trim()
    .replace(/^검색\s*:\s*/i, '')
    .replace(/^search\s*:\s*/i, '')
    .replace(/\s+/g, ' ');

  return cleaned.slice(0, 40).trim();
}

function buildLocalProxyEndpoint(base: string, allowNonLocal: boolean) {
  const url = parseUrlWithHttpFallback(base);
  if (!url) {
    throw new Error('Local Proxy URL이 올바르지 않습니다. 예: http://127.0.0.1:8787');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Local Proxy URL은 http/https만 지원합니다.');
  }
  if (!isLoopbackHostname(url.hostname) && !allowNonLocal) {
    throw new Error(
      `보안을 위해 비-로컬 Local Proxy URL 호출이 차단되었습니다: host=${url.hostname}. 옵션에서 “비-로컬 프록시 URL 허용(위험)”을 켜주세요.`,
    );
  }
  return new URL('/api/answer', url).toString();
}

export function createDcbotService(): DcbotRpc {
  const handledInMemory = new Set<string>();
  const cooldownByPage = new Map<string, number>();
  const generationCountByKey = new Map<string, number[]>();
  const cache = new Map<string, CacheEntry>();
  const errorDedupe = new Map<string, number>();

  let maxConcurrentGenerations = 1;
  let activeGenerations = 0;
  const generationQueue: Array<(release: () => void) => void> = [];
  let lastPruneAt = 0;
  let lastDebugSnapshotAt = 0;

  function normalizeMaxConcurrent(value: number) {
    const n = Number.isFinite(value) ? Math.trunc(value) : 1;
    return Math.max(1, Math.min(5, n));
  }

  function makeReleaseFn() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeGenerations = Math.max(0, activeGenerations - 1);
      while (generationQueue.length > 0 && activeGenerations < maxConcurrentGenerations) {
        activeGenerations += 1;
        const resolve = generationQueue.shift()!;
        resolve(makeReleaseFn());
      }
    };
  }

  async function acquireGenerationSlot(maxConcurrent: number): Promise<() => void> {
    maxConcurrentGenerations = normalizeMaxConcurrent(maxConcurrent);

    if (activeGenerations < maxConcurrentGenerations) {
      activeGenerations += 1;
      return makeReleaseFn();
    }

    return await new Promise<() => void>((resolve) => {
      generationQueue.push(resolve);
    });
  }

  function enforceRateLimit(key: string, maxPerMinute: number) {
    const limit = Math.max(1, Math.min(60, Math.trunc(maxPerMinute)));
    const t = now();

    const list = generationCountByKey.get(key) ?? [];
    const next = list.filter((ts) => t - ts < RATE_LIMIT_WINDOW_MS);
    if (next.length >= limit) {
      throw new Error(`요청이 너무 많아요. 60초에 최대 ${limit}회까지 생성할 수 있어요.`);
    }
    next.push(t);
    generationCountByKey.set(key, next);
  }

  function pruneGenerationState(settings: { cooldownSec: number; debug: boolean }) {
    const t = now();
    const minIntervalMs = 15_000;
    if (t - lastPruneAt < minIntervalMs && generationCountByKey.size < 80 && cooldownByPage.size < 80 && cache.size < 120) {
      return;
    }
    lastPruneAt = t;

    // Rolling rate limiter: drop old timestamps and delete empty keys.
    for (const [k, list] of generationCountByKey) {
      const next = list.filter((ts) => t - ts < RATE_LIMIT_WINDOW_MS);
      if (next.length === 0) generationCountByKey.delete(k);
      else if (next.length !== list.length) generationCountByKey.set(k, next);
    }

    // Cooldown tracking: delete safely-expired entries.
    const cooldownMs = settings.cooldownSec > 0 ? settings.cooldownSec * 1000 : 0;
    if (cooldownMs <= 0) {
      cooldownByPage.clear();
    } else {
      const expireAfterMs = cooldownMs + 60_000;
      for (const [k, ts] of cooldownByPage) {
        if (t - ts > expireAfterMs) cooldownByPage.delete(k);
      }
    }

    // Answer cache: delete old entries.
    for (const [k, entry] of cache) {
      if (t - entry.ts > CACHE_TTL_MS) cache.delete(k);
    }

    if (settings.debug && t - lastDebugSnapshotAt > 60_000) {
      lastDebugSnapshotAt = t;
      console.log('[dcbot] background state', {
        cache: cache.size,
        cooldown: cooldownByPage.size,
        rateKeys: generationCountByKey.size,
        queue: generationQueue.length,
        active: activeGenerations,
      });
    }
  }

  function redactSecrets(text: string) {
    return text
      .replace(/sk-[a-z0-9]{10,}/gi, 'sk-REDACTED')
      .replace(/bearer\s+[a-z0-9._-]+/gi, 'Bearer REDACTED')
      .replace(/x-dcbot-proxy-token\s*[:=]\s*[^\s,;]+/gi, 'X-DCBOT-PROXY-TOKEN: REDACTED');
  }

  function normalizeErrorEntry(entry: ErrorLogEntry): ErrorLogEntry {
    const message = redactSecrets(entry.message).trim().slice(0, 300);
    const detail = entry.detail ? redactSecrets(entry.detail).trim().slice(0, 2000) : undefined;
    return detail
      ? { ts: entry.ts || now(), scope: entry.scope, message, detail }
      : { ts: entry.ts || now(), scope: entry.scope, message };
  }

  function pruneErrorDedupeMap() {
    if (errorDedupe.size <= 200) return;
    const t = now();
    for (const [k, ts] of errorDedupe) {
      if (t - ts > 60_000) errorDedupe.delete(k);
    }
    if (errorDedupe.size > 400) errorDedupe.clear();
  }

  function makeErrorDedupeKey(entry: ErrorLogEntry) {
    const prefix = (entry.detail ?? '').slice(0, 140);
    return `${entry.scope}:${entry.message}:${prefix}`;
  }

  async function appendErrorLogDeduped(entry: ErrorLogEntry) {
    const normalized = normalizeErrorEntry(entry);
    const key = makeErrorDedupeKey(normalized);
    const t = now();
    const last = errorDedupe.get(key);
    if (typeof last === 'number' && t - last < 10_000) return;
    errorDedupe.set(key, t);
    pruneErrorDedupeMap();
    await appendErrorLog(normalized);
  }

  async function health() {
    try {
      const version = browser.runtime.getManifest().version;
      return { ok: true as const, version };
    } catch (error) {
      return { ok: false as const, error: String(error) };
    }
  }

  async function dcSearch(keyword: string, limit?: number) {
    const settings = await getSettings();
    if (!keyword.trim()) return [];

    const realLimit = typeof limit === 'number' ? Math.max(0, Math.min(10, Math.trunc(limit))) : settings.searchLimit;
    if (realLimit <= 0) return [];

    return await dcinsideSearch({
      galleryId: settings.galleryId,
      isMgallery: settings.isMgallery,
      keyword,
      limit: realLimit,
      timeoutMs: 8_000,
    });
  }

  async function generateAnswer(input: GenerateAnswerInput): Promise<GenerateAnswerResult> {
    const settings = await getSettings();

    const commentId = input.commentId.trim();
    const question = input.question.trim();
    if (!commentId) throw new Error('commentId가 비어있습니다.');

    const mode = input.mode ?? 'qa';
    if (mode === 'qa' && !question) throw new Error('질문이 비어있습니다.');

    if (handledInMemory.has(commentId) || (await isCommentHandled(commentId))) {
      throw new Error('이미 처리된 댓글입니다.');
    }

    const pageKey = (input.pageUrl ?? '').trim();
    if (pageKey.length > 0 && settings.cooldownSec > 0) {
      const last = cooldownByPage.get(pageKey);
      const minDelta = settings.cooldownSec * 1000;
      if (last && now() - last < minDelta) {
        throw new Error(`쿨다운 중입니다. (${settings.cooldownSec}s)`);
      }
      cooldownByPage.set(pageKey, now());
    }

    const questionHash = await sha256Hex(question);
    const cacheKey = `${commentId}:${questionHash}`;
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.ts < CACHE_TTL_MS) {
      return { answer: cached.answer, searchResults: cached.searchResults, cached: true };
    }

    const release = await acquireGenerationSlot(settings.maxConcurrentGenerations);
    try {
      pruneGenerationState({ cooldownSec: settings.cooldownSec, debug: settings.debug });

      const limitKey = pageKey.length > 0 ? pageKey : 'global';
      enforceRateLimit(limitKey, settings.maxGenerationsPerMinute);

      let searchResults: SearchResult[] | undefined;
      let instructions: string;
      let llmInput: string;

      if (mode === 'summary') {
        const hasPostContext =
          (input.postTitle && input.postTitle.trim().length > 0) || (input.postBodyText && input.postBodyText.trim().length > 0);
        if (!hasPostContext) throw new Error('요약할 글 내용(제목/본문)을 찾지 못했습니다.');

        ({ instructions, input: llmInput } = buildSummaryPrompt({
          postTitle: input.postTitle,
          postBodyText: input.postBodyText,
          maxAnswerChars: settings.maxAnswerChars,
        }));
      } else {
        const keyword = settings.searchEnabled ? extractKeyword(question) : '';
        if (settings.searchEnabled && keyword.length > 0) {
          try {
            const pageGalleryId = (input.pageGalleryId ?? '').trim();
            const galleryId = pageGalleryId.length > 0 ? pageGalleryId : settings.galleryId;
            const isMgallery = typeof input.pageIsMgallery === 'boolean' ? input.pageIsMgallery : settings.isMgallery;
            searchResults = await dcinsideSearch({
              galleryId,
              isMgallery,
              keyword,
              limit: settings.searchLimit,
              timeoutMs: 8_000,
            });
          } catch (error) {
            const detail =
              error instanceof DcinsideSearchTimeoutError
                ? `timeout (${error.timeoutMs}ms)`
                : error instanceof DcinsideSearchHttpError
                  ? `http (${error.status})`
                  : String(error);
            await appendErrorLogDeduped({ ts: now(), scope: 'background', message: 'DCInside 검색 실패', detail });
          }
        }

        ({ instructions, input: llmInput } = buildPrompt({
          question,
          postTitle: input.postTitle,
          postBodyText: input.postBodyText,
          recentComments: input.recentComments,
          searchResults,
          maxAnswerChars: settings.maxAnswerChars,
          includeSources: settings.includeSources,
        }));
      }

      let answerText: string;
      try {
        if (settings.providerMode === 'local_proxy') {
          const token = await getLocalProxyToken();
          if (!token) {
            throw new Error('로컬 프록시 토큰이 설정되어 있지 않습니다. (옵션에서 설정)');
          }
          const endpoint = buildLocalProxyEndpoint(settings.localProxyUrl ?? 'http://127.0.0.1:8787', settings.allowNonLocalProxyUrl);
          answerText = await callLocalProxyAnswer({
            url: endpoint,
            token,
            payload: {
              question,
              instructions,
              input: llmInput,
              model: settings.model,
              reasoningEffort: settings.reasoningEffort,
              searchResults: (searchResults ?? []).slice(0, settings.searchLimit),
            },
          });
        } else if (settings.providerMode === 'openai_direct') {
          if (!settings.allowBrowserKeyStorage) {
            throw new Error('openai_direct 사용을 위해 옵션에서 “브라우저 키 저장 허용”을 먼저 켜주세요.');
          }
          const apiKey = await getDirectApiKey();
          if (!apiKey) throw new Error('API Key가 설정되어 있지 않습니다. (옵션에서 설정)');

          const baseRaw = settings.directApiBaseUrl.trim();
          let baseUrl: URL;
          try {
            baseUrl = new URL(baseRaw);
          } catch {
            throw new Error('Direct API Base URL이 올바르지 않습니다. 예: https://api.openai.com/v1');
          }
          if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
            throw new Error('Direct API Base URL은 http/https만 지원합니다.');
          }

          const tryResponses = async () =>
            await callOpenAiResponses({
              apiKey,
              baseUrl: baseUrl.toString(),
              model: settings.model,
              reasoningEffort: settings.reasoningEffort,
              instructions,
              input: llmInput,
            });
          const tryChat = async () =>
            await callOpenAiChatCompletions({
              apiKey,
              baseUrl: baseUrl.toString(),
              model: settings.model,
              instructions,
              input: llmInput,
            });

          try {
            if (settings.directApiType === 'chat_completions') {
              answerText = await tryChat();
            } else if (settings.directApiType === 'responses') {
              answerText = await tryResponses();
            } else {
              try {
                answerText = await tryResponses();
              } catch (error) {
                if (error instanceof OpenAiApiError && (error.status === 404 || error.status === 405)) {
                  answerText = await tryChat();
                } else {
                  throw error;
                }
              }
            }
          } catch (error) {
            if (error instanceof TypeError && String(error).toLowerCase().includes('failed to fetch')) {
              throw new Error(
                'API 호출에 실패했습니다. Direct API Base URL/네트워크 권한을 확인하고, 옵션에서 “API 테스트”를 실행해 권한을 허용해주세요.',
              );
            }
            throw error;
          }
        } else if (settings.providerMode === 'google_gemini') {
          if (!settings.allowBrowserKeyStorage) {
            throw new Error('google_gemini 사용을 위해 옵션에서 “브라우저 키 저장 허용”을 먼저 켜주세요.');
          }
          const apiKey = await getDirectApiKey();
          if (!apiKey) throw new Error('Google API Key가 설정되어 있지 않습니다. (옵션에서 설정)');

          try {
            answerText = await callGeminiGenerateContent({
              apiKey,
              model: settings.model,
              instructions,
              input: llmInput,
              timeoutMs: 15_000,
            });
          } catch (error) {
            if (error instanceof GeminiApiError && (error.status === 404 || error.status === 400)) {
              throw new Error(`Gemini API 오류: ${error.message} (model=${settings.model})`);
            }
            if (error instanceof TypeError && String(error).toLowerCase().includes('failed to fetch')) {
              throw new Error('Gemini API 호출에 실패했습니다. 네트워크 권한을 확인하고, 옵션에서 “API 테스트”를 실행해 권한을 허용해주세요.');
            }
            throw error;
          }
        } else {
          throw new Error(`지원하지 않는 Provider Mode입니다: ${settings.providerMode}`);
        }
      } catch (error) {
        const host = (() => {
          const raw = (input.pageUrl ?? '').trim();
          if (!raw) return 'unknown';
          try {
            return new URL(raw).host || 'unknown';
          } catch {
            return 'unknown';
          }
        })();
        await appendErrorLogDeduped({
          ts: now(),
          scope: 'background',
          message: '답변 생성 실패',
          detail: `provider=${settings.providerMode} mode=${mode} host=${host} err=${String(error)}`,
        });
        throw error;
      }

      let answer = normalizeForComment(answerText);

      if (mode !== 'summary' && settings.includeSources && (searchResults?.length ?? 0) > 0) {
        answer += buildRelatedLinks(searchResults ?? [], Math.min(3, settings.searchLimit));
      }

      answer = clampTextChars(answer, settings.maxAnswerChars);
      cache.set(cacheKey, { answer, ts: now(), searchResults });

      return { answer, searchResults, cached: false };
    } finally {
      release();
    }
  }

  async function testApi(model?: string) {
    try {
      const settings = await getSettings();
      if (settings.providerMode === 'openai_direct') {
        if (!settings.allowBrowserKeyStorage) {
          return { ok: false as const, error: '옵션에서 “브라우저 키 저장 허용”을 먼저 켜주세요.' };
        }
        const apiKey = await getDirectApiKey();
        if (!apiKey) return { ok: false as const, error: 'API Key가 설정되어 있지 않습니다.' };

        const baseRaw = settings.directApiBaseUrl.trim();
        let baseUrl: URL;
        try {
          baseUrl = new URL(baseRaw);
        } catch {
          return { ok: false as const, error: 'Direct API Base URL이 올바르지 않습니다. 예: https://api.openai.com/v1' };
        }
        if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
          return { ok: false as const, error: 'Direct API Base URL은 http/https만 지원합니다.' };
        }

        const testModel = (model ?? '').trim() || settings.model;
        const base = baseUrl.toString();
        const instructions = '간단히 "ok"만 출력해.';
        const input = 'ping';

        if (settings.directApiType === 'chat_completions') {
          await callOpenAiChatCompletions({ apiKey, baseUrl: base, model: testModel, instructions, input, timeoutMs: 15_000 });
          return { ok: true as const, provider: 'openai_direct' as const, apiType: 'chat_completions' as const };
        }

        if (settings.directApiType === 'responses') {
          await callOpenAiResponses({
            apiKey,
            baseUrl: base,
            model: testModel,
            reasoningEffort: 'low',
            instructions,
            input,
            timeoutMs: 15_000,
          });
          return { ok: true as const, provider: 'openai_direct' as const, apiType: 'responses' as const };
        }

        try {
          await callOpenAiResponses({
            apiKey,
            baseUrl: base,
            model: testModel,
            reasoningEffort: 'low',
            instructions,
            input,
            timeoutMs: 15_000,
          });
          return { ok: true as const, provider: 'openai_direct' as const, apiType: 'responses' as const };
        } catch (error) {
          if (error instanceof OpenAiApiError && (error.status === 404 || error.status === 405)) {
            await callOpenAiChatCompletions({ apiKey, baseUrl: base, model: testModel, instructions, input, timeoutMs: 15_000 });
            return { ok: true as const, provider: 'openai_direct' as const, apiType: 'chat_completions' as const };
          }
          return { ok: false as const, error: String(error) };
        }
      }

      if (settings.providerMode === 'google_gemini') {
        if (!settings.allowBrowserKeyStorage) {
          return { ok: false as const, error: '옵션에서 “브라우저 키 저장 허용”을 먼저 켜주세요.' };
        }
        const apiKey = await getDirectApiKey();
        if (!apiKey) return { ok: false as const, error: 'Google API Key가 설정되어 있지 않습니다.' };

        const testModel = (model ?? '').trim() || settings.model;
        const instructions = '간단히 "ok"만 출력해.';
        const input = 'ping';
        await callGeminiGenerateContent({ apiKey, model: testModel, instructions, input, timeoutMs: 15_000 });
        return { ok: true as const, provider: 'google_gemini' as const };
      }

      return { ok: false as const, error: `현재 Provider Mode(${settings.providerMode})는 이 버튼에서 테스트하지 않습니다.` };
    } catch (error) {
      return { ok: false as const, error: String(error) };
    }
  }

  async function logError(entry: ErrorLogEntry) {
    await appendErrorLogDeduped(entry);
  }

  async function markHandled(commentId: string) {
    const id = commentId.trim();
    if (!id) return;
    handledInMemory.add(id);
    await markCommentHandled(id);
  }

  return {
    health,

    getSettings,
    setSettings,

    getSecretKey: getDirectApiKey,
    setSecretKey: setDirectApiKey,
    clearSecretKey: clearDirectApiKey,
    testApi,

    getLastError,
    getErrorLog,
    logError,
    clearErrorLog,

    dcSearch,
    generateAnswer,
    markCommentHandled: markHandled,
  };
}
