export type ReasoningEffort = 'low' | 'medium' | 'high';
export type ProviderMode = 'openai_direct' | 'google_gemini' | 'local_proxy';
export type DirectApiType = 'auto' | 'responses' | 'chat_completions';

export type Settings = {
  trigger: string;
  galleryId: string;
  isMgallery: boolean;

  qaUserInstructions: string;

  model: string;
  reasoningEffort: ReasoningEffort;
  maxAnswerChars: number;

  searchEnabled: boolean;
  searchLimit: number;

  autoReply: boolean;
  autoSubmit: boolean;
  onlyMyTrigger: boolean;
  cooldownSec: number;
  maxConcurrentGenerations: number;
  maxGenerationsPerMinute: number;
  debug: boolean;

  providerMode: ProviderMode;
  directApiBaseUrl: string;
  directApiType: DirectApiType;
  allowBrowserKeyStorage: boolean;
  allowNonLocalProxyUrl: boolean;
  localProxyUrl?: string;
};

export const DEFAULT_SETTINGS: Settings = {
  trigger: '@디시봇',
  galleryId: 'thesingularity',
  isMgallery: true,

  qaUserInstructions: '',

  model: 'gpt-5-mini',
  reasoningEffort: 'high',
  maxAnswerChars: 120,

  searchEnabled: true,
  searchLimit: 3,

  autoReply: true,
  autoSubmit: true,
  onlyMyTrigger: true,
  cooldownSec: 15,
  maxConcurrentGenerations: 1,
  maxGenerationsPerMinute: 4,
  debug: false,

  providerMode: 'local_proxy',
  directApiBaseUrl: 'https://api.openai.com/v1',
  directApiType: 'auto',
  allowBrowserKeyStorage: false,
  allowNonLocalProxyUrl: false,
  localProxyUrl: 'http://127.0.0.1:8787',
};

const SETTINGS_KEY = 'settings';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function toBool(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function toString(value: unknown, fallback: string) {
  if (typeof value === 'string') return value;
  return fallback;
}

function normalizeUserInstructions(value: unknown, fallback: string) {
  const raw = typeof value === 'string' ? value : fallback;
  const trimmed = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  // Keep small to avoid sync storage bloat.
  return trimmed.slice(0, 800);
}

function toReasoningEffort(value: unknown, fallback: ReasoningEffort): ReasoningEffort {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return fallback;
}

function toProviderMode(value: unknown, fallback: ProviderMode): ProviderMode {
  if (value === 'openai_direct' || value === 'google_gemini' || value === 'local_proxy') return value;
  return fallback;
}

function toDirectApiType(value: unknown, fallback: DirectApiType): DirectApiType {
  if (value === 'auto' || value === 'responses' || value === 'chat_completions') return value;
  return fallback;
}

export function normalizeSettings(raw: unknown): Settings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };

  return {
    trigger: toString(raw.trigger, DEFAULT_SETTINGS.trigger),
    galleryId: toString(raw.galleryId, DEFAULT_SETTINGS.galleryId),
    isMgallery: toBool(raw.isMgallery, DEFAULT_SETTINGS.isMgallery),

    qaUserInstructions: normalizeUserInstructions(raw.qaUserInstructions, DEFAULT_SETTINGS.qaUserInstructions),

    model: toString(raw.model, DEFAULT_SETTINGS.model),
    reasoningEffort: toReasoningEffort(raw.reasoningEffort, DEFAULT_SETTINGS.reasoningEffort),
    maxAnswerChars: clampInt(raw.maxAnswerChars, DEFAULT_SETTINGS.maxAnswerChars, 120, 400),

    searchEnabled: toBool(raw.searchEnabled, DEFAULT_SETTINGS.searchEnabled),
    searchLimit: clampInt(raw.searchLimit, DEFAULT_SETTINGS.searchLimit, 0, 10),

    autoReply: toBool(raw.autoReply, DEFAULT_SETTINGS.autoReply),
    autoSubmit: toBool(raw.autoSubmit, DEFAULT_SETTINGS.autoSubmit),
    onlyMyTrigger: toBool(raw.onlyMyTrigger, DEFAULT_SETTINGS.onlyMyTrigger),
    cooldownSec: clampInt(raw.cooldownSec, DEFAULT_SETTINGS.cooldownSec, 0, 3600),
    maxConcurrentGenerations: clampInt(raw.maxConcurrentGenerations, DEFAULT_SETTINGS.maxConcurrentGenerations, 1, 5),
    maxGenerationsPerMinute: clampInt(raw.maxGenerationsPerMinute, DEFAULT_SETTINGS.maxGenerationsPerMinute, 1, 60),
    debug: toBool(raw.debug, DEFAULT_SETTINGS.debug),

    providerMode: toProviderMode(raw.providerMode, DEFAULT_SETTINGS.providerMode),
    directApiBaseUrl: toString(raw.directApiBaseUrl, DEFAULT_SETTINGS.directApiBaseUrl),
    directApiType: toDirectApiType(raw.directApiType, DEFAULT_SETTINGS.directApiType),
    allowBrowserKeyStorage: toBool(raw.allowBrowserKeyStorage, DEFAULT_SETTINGS.allowBrowserKeyStorage),
    allowNonLocalProxyUrl: toBool(raw.allowNonLocalProxyUrl, DEFAULT_SETTINGS.allowNonLocalProxyUrl),
    localProxyUrl: toString(raw.localProxyUrl, DEFAULT_SETTINGS.localProxyUrl ?? ''),
  };
}

export async function getSettings(): Promise<Settings> {
  const data = await browser.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY]);
}

export async function setSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...partial });
  await browser.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}
