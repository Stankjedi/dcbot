import { OpenAiApiError } from '@/lib/llm/openaiResponses';

function joinBaseUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim();
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return new URL(path.replace(/^\//, ''), normalized).toString();
}

export function extractOpenAiModelIds(json: unknown): string[] {
  const j = json as any;
  const data = j?.data;
  if (!Array.isArray(data)) return [];

  const out = data
    .map((m: any) => (typeof m?.id === 'string' ? m.id.trim() : ''))
    .filter(Boolean);
  return Array.from(new Set(out));
}

export type OpenAiListModelsParams = {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
};

export async function listOpenAiModels(params: OpenAiListModelsParams): Promise<string[]> {
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 15_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = joinBaseUrl(params.baseUrl, 'models');
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const message =
        (typeof json?.error?.message === 'string' && json.error.message) ||
        (typeof json?.message === 'string' && json.message) ||
        `OpenAI API error (${res.status})`;
      throw new OpenAiApiError(message, res.status);
    }

    return extractOpenAiModelIds(json);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new OpenAiApiError(`OpenAI API timeout (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

