export type ErrorLogEntry = {
  ts: number;
  scope: 'background' | 'content' | 'options';
  message: string;
  detail?: string;
};

const ERROR_LOG_KEY = 'dcbot_error_log';
const LAST_ERROR_KEY = 'dcbot_last_error';
const HANDLED_MAP_KEY = 'dcbot_handled_comment_ids';
const LAST_SEEN_GALLERY_KEY = 'dcbot_last_seen_gallery';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

export async function setLastError(message: string | null): Promise<void> {
  if (message == null) {
    await browser.storage.local.remove(LAST_ERROR_KEY);
    return;
  }
  await browser.storage.local.set({ [LAST_ERROR_KEY]: message });
}

export async function getLastError(): Promise<string | null> {
  const data = await browser.storage.local.get(LAST_ERROR_KEY);
  const value = data[LAST_ERROR_KEY];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export async function appendErrorLog(entry: ErrorLogEntry, maxEntries = 50): Promise<void> {
  const data = await browser.storage.local.get(ERROR_LOG_KEY);
  const raw = data[ERROR_LOG_KEY];
  const list = Array.isArray(raw) ? raw : [];
  const next = [...list, entry].slice(-maxEntries);
  await browser.storage.local.set({ [ERROR_LOG_KEY]: next });
  await setLastError(`${entry.scope}: ${entry.message}`);
}

export async function getErrorLog(): Promise<ErrorLogEntry[]> {
  const data = await browser.storage.local.get(ERROR_LOG_KEY);
  const raw = data[ERROR_LOG_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!isRecord(item)) return null;
      const ts = typeof item.ts === 'number' ? item.ts : Date.now();
      const scope =
        item.scope === 'background' || item.scope === 'content' || item.scope === 'options'
          ? item.scope
          : 'background';
      const message = typeof item.message === 'string' ? item.message : '';
      if (message.length === 0) return null;
      const detail = typeof item.detail === 'string' ? item.detail : undefined;
      const entry: ErrorLogEntry = detail ? { ts, scope, message, detail } : { ts, scope, message };
      return entry;
    })
    .filter((x): x is ErrorLogEntry => x != null);
}

export async function clearErrorLog(): Promise<void> {
  await browser.storage.local.remove([ERROR_LOG_KEY, LAST_ERROR_KEY]);
}

export type LastSeenGallery = {
  ts: number;
  galleryId: string;
  isMgallery: boolean;
};

export async function setLastSeenGallery(galleryId: string, isMgallery: boolean): Promise<void> {
  const id = galleryId.trim();
  if (id.length === 0) return;
  const entry: LastSeenGallery = { ts: Date.now(), galleryId: id, isMgallery };
  await browser.storage.local.set({ [LAST_SEEN_GALLERY_KEY]: entry });
}

export async function getLastSeenGallery(): Promise<LastSeenGallery | null> {
  const data = await browser.storage.local.get(LAST_SEEN_GALLERY_KEY);
  const raw = data[LAST_SEEN_GALLERY_KEY];
  if (!isRecord(raw)) return null;
  const ts = typeof raw.ts === 'number' ? raw.ts : Number(raw.ts);
  const galleryId = typeof raw.galleryId === 'string' ? raw.galleryId.trim() : '';
  const isMgallery = typeof raw.isMgallery === 'boolean' ? raw.isMgallery : null;
  if (!Number.isFinite(ts) || galleryId.length === 0 || isMgallery == null) return null;
  return { ts, galleryId, isMgallery };
}

type HandledMap = Record<string, number>;

export function pruneHandledMap(map: HandledMap, maxSize: number): HandledMap {
  const limit = Math.max(1, Math.trunc(maxSize));
  const entries = Object.entries(map);
  if (entries.length <= limit) return { ...map };

  entries.sort((a, b) => a[1] - b[1]);
  const keep = entries.slice(-limit);
  const pruned: HandledMap = {};
  for (const [id, ts] of keep) pruned[id] = ts;
  return pruned;
}

export async function getHandledCommentMap(): Promise<HandledMap> {
  const data = await browser.storage.local.get(HANDLED_MAP_KEY);
  const raw = data[HANDLED_MAP_KEY];
  if (!isRecord(raw)) return {};
  const out: HandledMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    const ts = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ts)) continue;
    out[key] = ts;
  }
  return out;
}

export async function isCommentHandled(commentId: string): Promise<boolean> {
  const map = await getHandledCommentMap();
  return map[commentId] != null;
}

export async function markCommentHandled(commentId: string, maxSize = 500): Promise<void> {
  if (commentId.trim().length === 0) return;
  const map = await getHandledCommentMap();
  map[commentId] = Date.now();

  await browser.storage.local.set({ [HANDLED_MAP_KEY]: pruneHandledMap(map, maxSize) });
}
