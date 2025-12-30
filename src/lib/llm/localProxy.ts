type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type LocalProxyAnswerParams = {
  url: string;
  payload: Record<string, JsonValue>;
  token?: string;
  timeoutMs?: number;
};

export async function callLocalProxyAnswer(params: LocalProxyAnswerParams): Promise<string> {
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 15_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(params.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(params.token && params.token.trim().length > 0 ? { 'X-DCBOT-PROXY-TOKEN': params.token.trim() } : {}),
      },
      body: JSON.stringify(params.payload),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const message =
        (typeof json?.error === 'string' && json.error) ||
        (typeof json?.message === 'string' && json.message) ||
        `Local proxy error (${res.status})`;
      throw new Error(message);
    }
    const answer = typeof json?.answer === 'string' ? json.answer : null;
    if (!answer || answer.trim().length === 0) throw new Error('Local proxy: empty answer');
    return answer;
  } finally {
    clearTimeout(timeout);
  }
}
