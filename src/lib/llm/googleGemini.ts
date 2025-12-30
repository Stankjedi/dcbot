export class GeminiApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'GeminiApiError';
    this.status = status;
    this.body = body;
  }
}

export function extractGeminiText(json: unknown): string | null {
  const candidates = (json as any)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const first = candidates[0];
  const parts = first?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const texts = parts
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .map((t) => t.trim())
    .filter(Boolean);

  const joined = texts.join('\n').trim();
  return joined.length > 0 ? joined : null;
}

export function extractGeminiModelNames(json: unknown): string[] {
  const models = (json as any)?.models;
  if (!Array.isArray(models)) return [];

  const out: string[] = [];
  for (const m of models) {
    const rawName = typeof m?.name === 'string' ? m.name.trim() : '';
    if (!rawName) continue;

    const methods = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : null;
    if (methods && methods.length > 0 && !methods.includes('generateContent')) continue;

    const name = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
    out.push(name);
  }

  return Array.from(new Set(out));
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error != null &&
    'name' in error &&
    typeof (error as any).name === 'string' &&
    String((error as any).name) === 'AbortError'
  );
}

export type GeminiGenerateContentParams = {
  apiKey: string;
  model: string;
  instructions: string;
  input: string;
  timeoutMs?: number;
};

export async function callGeminiGenerateContent(params: GeminiGenerateContentParams): Promise<string> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) throw new Error('Gemini API Key is missing');

  const model = params.model.trim();
  if (!model) throw new Error('Gemini model is missing');

  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 15_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${params.instructions.trim()}\n\n${params.input.trim()}`.trim() }],
      },
    ],
  };

  try {
    const modelPath = model.startsWith('models/') ? model : `models/${model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const message =
        (typeof json?.error?.message === 'string' && json.error.message) ||
        (typeof json?.message === 'string' && json.message) ||
        `Gemini API error (${res.status})`;
      throw new GeminiApiError(message, res.status, json);
    }

    const text = extractGeminiText(json);
    if (!text) throw new Error('Gemini returned an empty answer');
    return text;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Gemini API timeout (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export type GeminiListModelsParams = {
  apiKey: string;
  timeoutMs?: number;
};

export async function listGeminiModels(params: GeminiListModelsParams): Promise<string[]> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) throw new Error('Gemini API Key is missing');

  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 15_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models';
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const message =
        (typeof json?.error?.message === 'string' && json.error.message) ||
        (typeof json?.message === 'string' && json.message) ||
        `Gemini API error (${res.status})`;
      throw new GeminiApiError(message, res.status, json);
    }

    return extractGeminiModelNames(json);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Gemini API timeout (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

