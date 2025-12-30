const DIRECT_API_KEY_KEY = 'dcbot_direct_api_key';
const LEGACY_OPENAI_KEY_KEY = 'openai_api_key';
const LOCAL_PROXY_TOKEN_KEY = 'dcbot_local_proxy_token';

export async function getDirectApiKey(): Promise<string | null> {
  const data = await browser.storage.local.get([DIRECT_API_KEY_KEY, LEGACY_OPENAI_KEY_KEY]);
  const value = data[DIRECT_API_KEY_KEY] ?? data[LEGACY_OPENAI_KEY_KEY];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function setDirectApiKey(key: string): Promise<void> {
  await browser.storage.local.set({ [DIRECT_API_KEY_KEY]: key.trim() });
  // Clean up legacy key, but keep read-compat in getDirectApiKey().
  await browser.storage.local.remove(LEGACY_OPENAI_KEY_KEY);
}

export async function clearDirectApiKey(): Promise<void> {
  await browser.storage.local.remove([DIRECT_API_KEY_KEY, LEGACY_OPENAI_KEY_KEY]);
}

export async function getLocalProxyToken(): Promise<string | null> {
  const data = await browser.storage.local.get(LOCAL_PROXY_TOKEN_KEY);
  const value = data[LOCAL_PROXY_TOKEN_KEY];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function setLocalProxyToken(token: string): Promise<void> {
  await browser.storage.local.set({ [LOCAL_PROXY_TOKEN_KEY]: token.trim() });
}

export async function clearLocalProxyToken(): Promise<void> {
  await browser.storage.local.remove(LOCAL_PROXY_TOKEN_KEY);
}
