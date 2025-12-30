import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const DCBOT_PROXY_TOKEN = (process.env.DCBOT_PROXY_TOKEN || '').trim();
const DCBOT_ALLOWED_ORIGINS = (process.env.DCBOT_ALLOWED_ORIGINS || '').trim();
const DCBOT_LLM_PROVIDER = (process.env.DCBOT_LLM_PROVIDER || 'openai').trim().toLowerCase();

function parseAllowedOrigins(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const items = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return null;
  return new Set(items);
}

const ALLOWED_ORIGINS = parseAllowedOrigins(DCBOT_ALLOWED_ORIGINS);

function getOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return null;
  const trimmed = origin.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isAllowedExtensionOrigin(origin) {
  return origin.startsWith('chrome-extension://');
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS) return ALLOWED_ORIGINS.has(origin);
  return isAllowedExtensionOrigin(origin);
}

function setCors(res, origin) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DCBOT-PROXY-TOKEN');
  // Required by Chrome Private Network Access for localhost from secure contexts.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, status, obj, origin) {
  setCors(res, origin);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function extractOutputText(json) {
  if (json && typeof json.output_text === 'string') return json.output_text;

  const output = json?.output;
  if (Array.isArray(output)) {
    const chunks = [];
    for (const item of output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type === 'output_text' && typeof c?.text === 'string') chunks.push(c.text);
        else if (typeof c?.text === 'string') chunks.push(c.text);
      }
    }
    const text = chunks.join('').trim();
    if (text) return text;
  }

  const choices = json?.choices;
  if (Array.isArray(choices)) {
    const text = choices
      .map((c) => c?.message?.content)
      .filter((v) => typeof v === 'string')
      .join('\n')
      .trim();
    if (text) return text;
  }

  return null;
}

function extractGeminiText(json) {
  const candidates = json?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const texts = parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .map((t) => t.trim())
    .filter(Boolean);
  const joined = texts.join('\n').trim();
  return joined.length > 0 ? joined : null;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

  const origin = getOrigin(req);

  // /health is open for diagnostics (no token), but keep CORS restricted.
  if (req.method === 'GET' && url.pathname === '/health') {
    if (origin && !isAllowedOrigin(origin) && !isAllowedExtensionOrigin(origin)) {
      sendJson(res, 403, { error: 'Forbidden origin' }, null);
      return;
    }
    const allowedOrigin = origin && (isAllowedOrigin(origin) || isAllowedExtensionOrigin(origin)) ? origin : null;
    sendJson(res, 200, { ok: true }, allowedOrigin);
    return;
  }

  // Enforce CORS policy for endpoints that matter.
  let allowedOrigin = null;
  if (ALLOWED_ORIGINS) {
    if (!origin || !isAllowedOrigin(origin)) {
      sendJson(res, 403, { error: 'Forbidden origin' }, null);
      return;
    }
    allowedOrigin = origin;
  } else {
    if (origin && !isAllowedExtensionOrigin(origin)) {
      sendJson(res, 403, { error: 'Forbidden origin' }, null);
      return;
    }
    allowedOrigin = origin && isAllowedExtensionOrigin(origin) ? origin : null;
  }

  if (req.method === 'OPTIONS') {
    setCors(res, allowedOrigin);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/answer') {
    if (!DCBOT_PROXY_TOKEN) {
      sendJson(res, 500, { error: 'DCBOT_PROXY_TOKEN is not set' }, allowedOrigin);
      return;
    }

    const provider = DCBOT_LLM_PROVIDER === 'gemini' ? 'gemini' : 'openai';
    if (provider === 'openai' && !OPENAI_API_KEY) {
      sendJson(res, 500, { error: 'OPENAI_API_KEY is not set' }, allowedOrigin);
      return;
    }
    if (provider === 'gemini' && !GEMINI_API_KEY) {
      sendJson(res, 500, { error: 'GEMINI_API_KEY is not set' }, allowedOrigin);
      return;
    }

    const provided = req.headers['x-dcbot-proxy-token'];
    const providedToken =
      typeof provided === 'string' ? provided.trim() : Array.isArray(provided) ? (provided[0] ?? '').trim() : '';
    if (!providedToken) {
      sendJson(res, 401, { error: 'Missing X-DCBOT-PROXY-TOKEN' }, allowedOrigin);
      return;
    }
    if (providedToken !== DCBOT_PROXY_TOKEN) {
      sendJson(res, 403, { error: 'Invalid proxy token' }, allowedOrigin);
      return;
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: `Invalid JSON: ${String(error)}` }, allowedOrigin);
      return;
    }

    const modelDefault = provider === 'gemini' ? 'gemini-2.0-flash' : 'gpt-5-mini';
    const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : modelDefault;
    const instructions = typeof body?.instructions === 'string' ? body.instructions : '';
    const input = typeof body?.input === 'string' ? body.input : '';
    const reasoningEffort = typeof body?.reasoningEffort === 'string' ? body.reasoningEffort : undefined;

    if (!instructions.trim() || !input.trim()) {
      sendJson(res, 400, { error: 'Missing "instructions" or "input"' }, allowedOrigin);
      return;
    }

    try {
      if (provider === 'gemini') {
        const modelPath = model.startsWith('models/') ? model : `models/${model}`;
        const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;
        const payload = {
          contents: [
            {
              role: 'user',
              parts: [{ text: `${instructions.trim()}\n\n${input.trim()}`.trim() }],
            },
          ],
        };

        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
          },
          body: JSON.stringify(payload),
        });

        const json = await r.json().catch(() => null);
        if (!r.ok) {
          const msg = json?.error?.message || `Gemini API error (${r.status})`;
          sendJson(res, r.status, { error: msg }, allowedOrigin);
          return;
        }

        const answer = extractGeminiText(json);
        if (!answer) {
          sendJson(res, 502, { error: 'Gemini returned an empty answer' }, allowedOrigin);
          return;
        }

        sendJson(res, 200, { answer }, allowedOrigin);
        return;
      }

      const payload = {
        model,
        instructions,
        input,
        ...(reasoningEffort === 'low' || reasoningEffort === 'medium' || reasoningEffort === 'high'
          ? { reasoning: { effort: reasoningEffort } }
          : {}),
      };

      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const json = await r.json().catch(() => null);
      if (!r.ok) {
        const msg = json?.error?.message || `OpenAI API error (${r.status})`;
        sendJson(res, r.status, { error: msg }, allowedOrigin);
        return;
      }

      const answer = extractOutputText(json);
      if (!answer) {
        sendJson(res, 502, { error: 'OpenAI returned an empty answer' }, allowedOrigin);
        return;
      }

      sendJson(res, 200, { answer }, allowedOrigin);
      return;
    } catch (error) {
      sendJson(res, 502, { error: String(error) }, allowedOrigin);
      return;
    }
  }

  sendJson(res, 404, { error: 'Not found' }, allowedOrigin);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dcbot-proxy] listening on http://127.0.0.1:${PORT}`);
});
