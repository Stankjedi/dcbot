import type { ReasoningEffort } from '@/lib/storage/settings';

export type OpenAiResponsesParams = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  instructions: string;
  input: string;
  timeoutMs?: number;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function extractOutputText(json: unknown): string | null {
  const j = json as any;
  if (typeof j?.output_text === 'string') return j.output_text;

  const output = j?.output;
  if (Array.isArray(output)) {
    const chunks: string[] = [];
    for (const item of output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (typeof c?.type === 'string' && c.type === 'output_text' && typeof c?.text === 'string') {
          chunks.push(c.text);
        } else if (typeof c?.text === 'string') {
          chunks.push(c.text);
        }
      }
    }
    const text = chunks.join('').trim();
    if (text.length > 0) return text;
  }

  // Fallback for chat-completions-like payloads
  const choices = j?.choices;
  if (Array.isArray(choices)) {
    const text = choices
      .map((c: any) => c?.message?.content)
      .filter((v: any) => typeof v === 'string')
      .join('\n')
      .trim();
    if (text.length > 0) return text;
  }

  return null;
}

function getErrorMessageFromJson(json: any): string | null {
  const err = json?.error;
  if (typeof err?.message === 'string') return err.message;
  if (typeof json?.message === 'string') return json.message;
  return null;
}

export class OpenAiApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OpenAiApiError';
    this.status = status;
  }
}

function joinBaseUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim();
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return new URL(path.replace(/^\//, ''), normalized).toString();
}

export async function callOpenAiResponses(params: OpenAiResponsesParams): Promise<string> {
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 25_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const body: Record<string, JsonValue> = {
    model: params.model,
    instructions: params.instructions,
    input: params.input,
  };
  if (params.reasoningEffort) {
    body.reasoning = { effort: params.reasoningEffort };
  }

  try {
    const baseUrl = params.baseUrl?.trim() || 'https://api.openai.com/v1';
    const res = await fetch(joinBaseUrl(baseUrl, 'responses'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const message = getErrorMessageFromJson(json) ?? `OpenAI API error (${res.status})`;
      throw new OpenAiApiError(message, res.status);
    }

    const text = extractOutputText(json);
    if (!text) throw new OpenAiApiError('OpenAI API: empty response text', res.status);
    return text;
  } catch (error) {
    if (error instanceof OpenAiApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new OpenAiApiError(`OpenAI API timeout (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export type OpenAiChatCompletionsParams = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  instructions: string;
  input: string;
  timeoutMs?: number;
};

export async function callOpenAiChatCompletions(params: OpenAiChatCompletionsParams): Promise<string> {
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 25_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const body: Record<string, JsonValue> = {
    model: params.model,
    messages: [
      { role: 'system', content: params.instructions },
      { role: 'user', content: params.input },
    ],
  };

  try {
    const baseUrl = params.baseUrl?.trim() || 'https://api.openai.com/v1';
    const res = await fetch(joinBaseUrl(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const message = getErrorMessageFromJson(json) ?? `OpenAI API error (${res.status})`;
      throw new OpenAiApiError(message, res.status);
    }

    const text = extractOutputText(json);
    if (!text) throw new OpenAiApiError('OpenAI API: empty response text', res.status);
    return text;
  } catch (error) {
    if (error instanceof OpenAiApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new OpenAiApiError(`OpenAI API timeout (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
