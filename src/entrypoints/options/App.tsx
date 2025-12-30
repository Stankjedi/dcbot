import { useEffect, useState } from 'react';
import type { Settings } from '@/lib/storage/settings';
import { DEFAULT_SETTINGS, getSettings as loadSettings, setSettings as persistSettings } from '@/lib/storage/settings';
import { clearDirectApiKey, getDirectApiKey, setDirectApiKey, clearLocalProxyToken, getLocalProxyToken, setLocalProxyToken } from '@/lib/storage/secrets';
import { appendErrorLog, clearErrorLog, getErrorLog, getLastError, getLastSeenGallery, type LastSeenGallery } from '@/lib/storage/localState';
import { callGeminiGenerateContent, listGeminiModels } from '@/lib/llm/googleGemini';
import { callOpenAiChatCompletions, callOpenAiResponses, OpenAiApiError } from '@/lib/llm/openaiResponses';
import { listOpenAiModels } from '@/lib/llm/openaiModels';
import { isLoopbackHostname, parseUrlWithHttpFallback, toHostPermissionPattern } from '@/lib/util/url';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [proxyToken, setProxyToken] = useState('');
  const [showProxyToken, setShowProxyToken] = useState(false);
  const [proxyTokenMessage, setProxyTokenMessage] = useState<string | null>(null);
  const [lastSeenGallery, setLastSeenGallery] = useState<LastSeenGallery | null>(null);
  const [ackBrowserKeyStorage, setAckBrowserKeyStorage] = useState(false);
  const [ackNonLocalProxyUrl, setAckNonLocalProxyUrl] = useState(false);
  const [proxyTestMessage, setProxyTestMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [modelListMessage, setModelListMessage] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<Array<{ ts: number; scope: string; message: string; detail?: string }>>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastInitAt, setLastInitAt] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setInitError(null);
      try {
        const s = await loadSettings();
        setSettingsState(s);

        const [log, le, gallery] = await Promise.all([getErrorLog(), getLastError(), getLastSeenGallery()]);
        setErrorLog(log);
        setLastError(le);
        setLastSeenGallery(gallery);

        // Avoid reading the key unless the user explicitly allowed browser key storage.
        const k = s.allowBrowserKeyStorage ? await getDirectApiKey() : null;
        setApiKey(k ?? '');

        const t = await getLocalProxyToken();
        setProxyToken(t ?? '');
      } catch (error) {
        setInitError(String(error));
        setSettingsState({ ...DEFAULT_SETTINGS });
      } finally {
        setLoading(false);
        setLastInitAt(Date.now());
      }
    })();
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettingsState((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaveState('idle');
    setSaveMessage(null);
    if (key === 'providerMode' || key === 'directApiBaseUrl' || key === 'directApiType') {
      setAvailableModels(null);
      setModelListMessage(null);
    }
  }

  async function saveAll() {
    if (!settings) return;
    setSaveState('saving');
    setSaveMessage(null);
    try {
      const next = await persistSettings(settings);
      setSettingsState(next);
      const isDirectProvider = settings.providerMode === 'openai_direct' || settings.providerMode === 'google_gemini';
      if (isDirectProvider && settings.allowBrowserKeyStorage) {
        if (apiKey.trim().length > 0) await setDirectApiKey(apiKey);
      }
      setSaveState('saved');
      const keySaved =
        isDirectProvider ? (settings.allowBrowserKeyStorage ? ' (키 포함)' : ' (키 저장 안 함)') : '';
      setSaveMessage(`저장 완료${keySaved}`);
      await refreshLogs();
    } catch (error) {
      setSaveState('error');
      setSaveMessage(String(error));
    }
  }

  async function enableBrowserKeyStorage() {
    if (!settings) return;
    const next = await persistSettings({ allowBrowserKeyStorage: true });
    setSettingsState(next);
    setAckBrowserKeyStorage(false);
    setApiKey((await getDirectApiKey()) ?? '');
    setSaveState('saved');
    setSaveMessage('브라우저(확장) 내부 키 저장을 허용했습니다.');
  }

  async function enableNonLocalProxyUrl() {
    if (!settings) return;
    const next = await persistSettings({ allowNonLocalProxyUrl: true });
    setSettingsState(next);
    setAckNonLocalProxyUrl(false);
    setSaveState('saved');
    setSaveMessage('비-로컬 프록시 URL 허용을 켰습니다. (위험)');
  }

  async function disableNonLocalProxyUrl() {
    if (!settings) return;
    const next = await persistSettings({ allowNonLocalProxyUrl: false });
    setSettingsState(next);
    setSaveState('saved');
    setSaveMessage('비-로컬 프록시 URL 허용을 껐습니다.');
  }

  async function clearKey() {
    await clearDirectApiKey();
    setApiKey('');
    setAvailableModels(null);
    setModelListMessage(null);
  }

  async function saveProxyToken() {
    setProxyTokenMessage('저장 중…');
    try {
      const trimmed = proxyToken.trim();
      if (trimmed.length === 0) {
        await clearLocalProxyToken();
        setProxyTokenMessage('토큰을 삭제했습니다.');
      } else {
        await setLocalProxyToken(trimmed);
        setProxyTokenMessage('토큰 저장 완료');
      }
    } catch (error) {
      setProxyTokenMessage(String(error));
    }
  }

  async function clearProxyToken() {
    await clearLocalProxyToken();
    setProxyToken('');
    setProxyTokenMessage('토큰을 삭제했습니다.');
  }

  async function testLocalProxy() {
    if (!settings || settings.providerMode !== 'local_proxy') return;
    setProxyTestMessage('테스트 중…');

    const base = (settings.localProxyUrl ?? '').trim();
    const url = parseUrlWithHttpFallback(base);
    if (!url) {
      setProxyTestMessage('실패: Local Proxy URL 형식이 올바르지 않습니다.');
      return;
    }

    if (!isLoopbackHostname(url.hostname) && !settings.allowNonLocalProxyUrl) {
      setProxyTestMessage('차단됨: 비-로컬 프록시 URL은 허용 게이트를 먼저 켜주세요.');
      return;
    }

    const pattern = toHostPermissionPattern(url);
    if (pattern) {
      const has = await browser.permissions.contains({ origins: [pattern] });
      if (!has) {
        const granted = await browser.permissions.request({ origins: [pattern] });
        if (!granted) {
          setProxyTestMessage(`차단됨: 네트워크 권한이 필요합니다. (${pattern})`);
          return;
        }
      }
    }

    const healthUrl = new URL('/health', url).toString();
    const apiUrl = new URL('/api/answer', url).toString();
    const token = proxyToken.trim();

    // Step A: /health
    try {
      const res = await fetch(healthUrl, { method: 'GET' });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || json?.ok !== true) {
        const msg = (typeof json?.error === 'string' && json.error) || `HTTP ${res.status}`;
        setProxyTestMessage(`실패(/health): ${msg}`);
        await appendErrorLog({ ts: Date.now(), scope: 'options', message: 'Local proxy test failed', detail: `step=health status=${res.status}` });
        return;
      }
    } catch (error) {
      setProxyTestMessage(`실패(/health): ${String(error)}`);
      await appendErrorLog({ ts: Date.now(), scope: 'options', message: 'Local proxy test failed', detail: 'step=health err=fetch' });
      return;
    }

    // Step B: /api/answer (intentionally invalid payload to avoid calling OpenAI)
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token.length > 0 ? { 'X-DCBOT-PROXY-TOKEN': token } : {}),
        },
        body: JSON.stringify({ instructions: '', input: '' }),
      });
      const json = (await res.json().catch(() => null)) as any;
      const errorText = (typeof json?.error === 'string' && json.error) || (typeof json?.message === 'string' && json.message) || '';

      if (res.status === 400 && errorText.toLowerCase().includes('missing')) {
        setProxyTestMessage('성공: 인증/환경변수 OK (의도된 400)');
        return;
      }
      if (res.status === 401) {
        setProxyTestMessage('실패: 토큰이 없습니다. (401)');
        return;
      }
      if (res.status === 403) {
        setProxyTestMessage('실패: 토큰이 틀렸거나 Origin이 차단되었습니다. (403)');
        return;
      }
      if (res.status === 500) {
        setProxyTestMessage('실패: 서버 환경변수(OPENAI_API_KEY/DCBOT_PROXY_TOKEN)가 설정되지 않았습니다. (500)');
        return;
      }

      if (!res.ok) {
        setProxyTestMessage(`실패(/api/answer): ${errorText || `HTTP ${res.status}`}`);
        await appendErrorLog({ ts: Date.now(), scope: 'options', message: 'Local proxy test failed', detail: `step=answer status=${res.status}` });
        return;
      }

      // Should not happen with invalid payload.
      setProxyTestMessage('성공: 예기치 않게 정상 응답을 받았습니다.');
    } catch (error) {
      setProxyTestMessage(`실패(/api/answer): ${String(error)}`);
      await appendErrorLog({ ts: Date.now(), scope: 'options', message: 'Local proxy test failed', detail: 'step=answer err=fetch' });
    }
  }

  async function applyLastSeenGallery() {
    if (!settings || !lastSeenGallery) return;
    const next = await persistSettings({ galleryId: lastSeenGallery.galleryId, isMgallery: lastSeenGallery.isMgallery });
    setSettingsState(next);
    setSaveState('saved');
    setSaveMessage('최근 감지된 갤러리 설정을 적용했습니다.');
  }

  async function fetchModelList() {
    if (!settings) return;
    if (settings.providerMode === 'local_proxy') {
      setModelListMessage('local_proxy 모드는 서버 업스트림에 따라 모델이 달라요.');
      return;
    }
    if (!settings.allowBrowserKeyStorage) {
      setModelListMessage('브라우저 키 저장 허용을 먼저 켜주세요.');
      return;
    }

    const key = apiKey.trim();
    if (key.length === 0) {
      setModelListMessage('API Key가 비어있습니다.');
      return;
    }

    setModelListMessage('모델 목록 불러오는 중…');
    try {
      await setDirectApiKey(key);

      if (settings.providerMode === 'google_gemini') {
        const permissionUrl = new URL('https://generativelanguage.googleapis.com');
        const pattern = toHostPermissionPattern(permissionUrl);
        if (pattern) {
          const has = await browser.permissions.contains({ origins: [pattern] });
          if (!has) {
            const granted = await browser.permissions.request({ origins: [pattern] });
            if (!granted) {
              setModelListMessage(`차단됨: 네트워크 권한이 필요합니다. (${pattern})`);
              return;
            }
          }
        }

        const models = (await listGeminiModels({ apiKey: key, timeoutMs: 15_000 })).sort((a, b) => a.localeCompare(b));
        setAvailableModels(models);
        setModelListMessage(models.length > 0 ? `사용 가능한 모델 ${models.length}개` : '모델 목록이 비어있습니다.');
        return;
      }

      // openai_direct (OpenAI-compatible)
      const baseRaw = settings.directApiBaseUrl.trim();
      let permissionUrl: URL;
      try {
        permissionUrl = new URL(baseRaw);
      } catch {
        setModelListMessage('실패: Direct API Base URL 형식이 올바르지 않습니다. 예: https://api.openai.com/v1');
        return;
      }
      const pattern = toHostPermissionPattern(permissionUrl);
      if (pattern) {
        const has = await browser.permissions.contains({ origins: [pattern] });
        if (!has) {
          const granted = await browser.permissions.request({ origins: [pattern] });
          if (!granted) {
            setModelListMessage(`차단됨: 네트워크 권한이 필요합니다. (${pattern})`);
            return;
          }
        }
      }

      const models = (await listOpenAiModels({ apiKey: key, baseUrl: baseRaw, timeoutMs: 15_000 })).sort((a, b) => a.localeCompare(b));
      setAvailableModels(models);
      setModelListMessage(models.length > 0 ? `사용 가능한 모델 ${models.length}개` : '모델 목록이 비어있습니다.');
    } catch (error) {
      const msg = String(error);
      setModelListMessage(`실패: ${msg}`);
      await appendErrorLog({
        ts: Date.now(),
        scope: 'options',
        message: '모델 목록 불러오기 실패',
        detail: `provider=${settings.providerMode} err=${msg}`,
      });
    }
  }

  async function testKey() {
    if (!settings) return;
    if (settings.providerMode === 'local_proxy') {
      setTestMessage('local_proxy는 “Test local proxy”를 사용하세요.');
      return;
    }

    if (!settings.allowBrowserKeyStorage) {
      setTestMessage('브라우저 키 저장 허용을 먼저 켜주세요.');
      return;
    }
    setTestMessage('테스트 중…');

    const key = apiKey.trim();
    if (key.length === 0) {
      setTestMessage('실패: API Key가 비어있습니다.');
      return;
    }

    let permissionUrl: URL | null = null;
    if (settings.providerMode === 'openai_direct') {
      const baseRaw = settings.directApiBaseUrl.trim();
      try {
        permissionUrl = new URL(baseRaw);
      } catch {
        permissionUrl = null;
      }
      if (!permissionUrl) {
        setTestMessage('실패: Direct API Base URL 형식이 올바르지 않습니다. 예: https://api.openai.com/v1');
        return;
      }
      if (permissionUrl.protocol !== 'https:' && permissionUrl.protocol !== 'http:') {
        setTestMessage('실패: Direct API Base URL은 http/https만 지원합니다.');
        return;
      }
    } else if (settings.providerMode === 'google_gemini') {
      permissionUrl = new URL('https://generativelanguage.googleapis.com');
    }

    const pattern = permissionUrl ? toHostPermissionPattern(permissionUrl) : null;
    if (pattern) {
      try {
        const has = await browser.permissions.contains({ origins: [pattern] });
        if (!has) {
          const granted = await browser.permissions.request({ origins: [pattern] });
          if (!granted) {
            setTestMessage(`차단됨: 네트워크 권한이 필요합니다. (${pattern})`);
            return;
          }
        }
      } catch (error) {
        setTestMessage(`실패: 권한 확인/요청 중 오류가 발생했습니다. (${String(error)})`);
        return;
      }
    }

    // Ensure the currently typed key is the one persisted (background also reads it).
    await setDirectApiKey(key);

    try {
      const instructions = '간단히 "ok"만 출력해.';
      const input = 'ping';

      if (settings.providerMode === 'google_gemini') {
        const testModel = settings.model.trim() || 'gemini-2.0-flash';
        await callGeminiGenerateContent({ apiKey: key, model: testModel, instructions, input, timeoutMs: 15_000 });
        setTestMessage('성공: Gemini API 사용 가능');
        await fetchModelList();
      } else {
        const base = permissionUrl!.toString();
        const testModel = settings.model.trim() || 'gpt-5-mini';

        const tryResponses = async () =>
          await callOpenAiResponses({
            apiKey: key,
            baseUrl: base,
            model: testModel,
            reasoningEffort: 'low',
            instructions,
            input,
            timeoutMs: 15_000,
          });
        const tryChat = async () =>
          await callOpenAiChatCompletions({
            apiKey: key,
            baseUrl: base,
            model: testModel,
            instructions,
            input,
            timeoutMs: 15_000,
          });

        let apiType: 'responses' | 'chat_completions' = 'responses';
        if (settings.directApiType === 'chat_completions') {
          await tryChat();
          apiType = 'chat_completions';
        } else if (settings.directApiType === 'responses') {
          await tryResponses();
          apiType = 'responses';
        } else {
          try {
            await tryResponses();
            apiType = 'responses';
          } catch (error) {
            if (error instanceof OpenAiApiError && (error.status === 404 || error.status === 405)) {
              await tryChat();
              apiType = 'chat_completions';
            } else {
              throw error;
            }
          }
        }

        setTestMessage(`성공: API 사용 가능 (${apiType})`);
        await fetchModelList();
      }
    } catch (error) {
      const msg = String(error);
      setTestMessage(`실패: ${msg}`);
      await appendErrorLog({ ts: Date.now(), scope: 'options', message: 'API 테스트 실패', detail: `provider=${settings.providerMode} err=${msg}` });
    }
    await refreshLogs();
  }

  async function refreshLogs() {
    setErrorLog(await getErrorLog());
    setLastError(await getLastError());
  }

  async function clearLogs() {
    await clearErrorLog();
    await refreshLogs();
  }

  function redact(text: string) {
    return text
      .replace(/sk-[a-z0-9]{10,}/gi, 'sk-REDACTED')
      .replace(/bearer\s+[a-z0-9._-]+/gi, 'Bearer REDACTED')
      .replace(/x-dcbot-proxy-token\s*[:=]\s*[^\s,;]+/gi, 'X-DCBOT-PROXY-TOKEN: REDACTED');
  }

  function clamp(text: string, max: number) {
    const t = text.trim();
    if (t.length <= max) return t;
    return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  }

  function buildRedactedExportPayload() {
    const exportedAt = new Date().toISOString();
    const safeLastError = lastError ? clamp(redact(lastError), 300) : null;
    const entries = errorLog.map((e) => ({
      ts: e.ts,
      scope: e.scope,
      message: clamp(redact(e.message), 300),
      ...(e.detail ? { detail: clamp(redact(e.detail), 2000) } : {}),
    }));
    return { exportedAt, lastError: safeLastError, entries };
  }

  async function copyRedactedLogJson() {
    setExportMessage('Copying…');
    try {
      const payload = buildRedactedExportPayload();
      const json = JSON.stringify(payload, null, 2);
      await navigator.clipboard.writeText(json);
      setExportMessage('Copied.');
    } catch (error) {
      setExportMessage(`Copy failed: ${String(error)}`);
    }
  }

  function downloadRedactedLogJson() {
    setExportMessage('Downloading…');
    try {
      const payload = buildRedactedExportPayload();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dcbot_error_log_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportMessage('Downloaded.');
    } catch (error) {
      setExportMessage(`Download failed: ${String(error)}`);
    }
  }

  if (loading || !settings) {
    return (
      <div className="wrap">
        <h1 className="title">디시봇 옵션</h1>
        <p className="muted">불러오는 중…</p>
      </div>
    );
  }

  const isDirectProvider = settings.providerMode === 'openai_direct' || settings.providerMode === 'google_gemini';
  const canUseDirectKey = !isDirectProvider || settings.allowBrowserKeyStorage;
  const canFetchModelList = isDirectProvider && settings.allowBrowserKeyStorage && apiKey.trim().length > 0;
  const modelSelectValue =
    availableModels && availableModels.includes(settings.model.trim()) ? settings.model.trim() : '';
  const missingProxyToken = settings.providerMode === 'local_proxy' && proxyToken.trim().length === 0;

  const parsedProxyBaseUrl = settings.providerMode === 'local_proxy' ? parseUrlWithHttpFallback(settings.localProxyUrl ?? '') : null;
  const proxyHost = parsedProxyBaseUrl?.hostname ?? '';
  const isProxyNonLoopback = parsedProxyBaseUrl ? !isLoopbackHostname(parsedProxyBaseUrl.hostname) : false;
  const isProxyUrlInvalid = settings.providerMode === 'local_proxy' && (settings.localProxyUrl ?? '').trim().length > 0 && !parsedProxyBaseUrl;
  const needsNonLocalProxyGate = settings.providerMode === 'local_proxy' && isProxyNonLoopback && !settings.allowNonLocalProxyUrl;

  return (
    <div className="wrap">
      <div className="header">
        <h1 className="title">DCInside 디시봇 옵션</h1>
        <div className="header-actions">
          <button className="btn" onClick={saveAll} disabled={saveState === 'saving'}>
            {saveState === 'saving' ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>

      <div className="notice danger">
        <div className="notice-title">중요: API Key 보안 경고</div>
        <div className="notice-body">
          API Key를 확장(브라우저) 안에 저장하는 것은 유출 위험이 있습니다. 개인 BYOK 용도로만 사용하세요. 가능하면{' '}
          <b>local_proxy</b> 모드를 권장합니다.
        </div>
      </div>

      {initError && (
        <div className="notice danger">
          <div className="notice-title">옵션 초기화 실패</div>
          <div className="notice-body">
            옵션을 불러오는 중 오류가 발생했습니다. 페이지를 새로고침하거나, `chrome://extensions`에서 확장 프로그램을 다시 로드해
            보세요.
            <div className="muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
              {String(initError)}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => location.reload()}>
                새로고침
              </button>
            </div>
          </div>
        </div>
      )}

      {saveMessage && <div className={`notice ${saveState === 'error' ? 'danger' : 'ok'}`}>{saveMessage}</div>}

      <section className="card">
        <h2 className="card-title">기본</h2>
        <div className="grid">
          <label className="field">
            <div className="label">트리거</div>
            <input value={settings.trigger} onChange={(e) => update('trigger', e.target.value)} />
          </label>

          <label className="field">
            <div className="label">갤러리 ID</div>
            <input value={settings.galleryId} onChange={(e) => update('galleryId', e.target.value)} />
          </label>

          <label className="field check">
            <input type="checkbox" checked={settings.isMgallery} onChange={(e) => update('isMgallery', e.target.checked)} />
            <div className="label">mgallery 사용</div>
          </label>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <div className="label">최근 감지된 갤러리(현재 페이지 기반)</div>
            {lastSeenGallery ? (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="muted">
                  id=<b>{lastSeenGallery.galleryId}</b> / mgallery=<b>{String(lastSeenGallery.isMgallery)}</b> /{' '}
                  {new Date(lastSeenGallery.ts).toLocaleString()}
                </div>
                <button className="btn" onClick={applyLastSeenGallery}>
                  적용
                </button>
              </div>
            ) : (
              <div className="muted">아직 감지된 값이 없어요. 디시 게시글 페이지를 열면 자동으로 저장됩니다.</div>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">연결</h2>
        <div className="grid">
          <label className="field">
            <div className="label">Provider Mode</div>
            <select value={settings.providerMode} onChange={(e) => update('providerMode', e.target.value as Settings['providerMode'])}>
              <option value="local_proxy">local_proxy (권장)</option>
              <option value="openai_direct">openai_direct (OpenAI-compatible)</option>
              <option value="google_gemini">google_gemini (Gemini API)</option>
            </select>
          </label>

          {settings.providerMode === 'local_proxy' ? (
            <>
              <label className="field">
                <div className="label">Local Proxy URL</div>
                <input
                  value={settings.localProxyUrl ?? ''}
                  onChange={(e) => update('localProxyUrl', e.target.value)}
                  placeholder="http://127.0.0.1:8787"
                />
              </label>

              {isProxyUrlInvalid && (
                <div className="notice danger" style={{ gridColumn: '1 / -1', margin: '0 0 8px' }}>
                  Local Proxy URL 형식이 올바르지 않습니다. 예: <b>http://127.0.0.1:8787</b>
                </div>
              )}

              {needsNonLocalProxyGate && (
                <div className="notice danger" style={{ gridColumn: '1 / -1', margin: '0 0 8px' }}>
                  <div className="notice-title">비-로컬 프록시 URL 차단됨</div>
                  <div className="notice-body">
                    현재 <b>{proxyHost || '(unknown host)'}</b>는 로컬 호스트(127.0.0.1/localhost/::1)가 아니어서, 보안을 위해 로컬
                    프록시 호출이 차단됩니다. (프록시 토큰/요청 데이터 유출 위험)
                    <ul style={{ margin: '8px 0 10px', paddingLeft: 18 }}>
                      <li>가능하면 로컬(loopback) 주소를 사용하세요.</li>
                      <li>정말 필요한 경우에만, 위험을 이해한 뒤 허용을 켜세요.</li>
                    </ul>
                    <label className="field check" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={ackNonLocalProxyUrl}
                        onChange={(e) => setAckNonLocalProxyUrl(e.target.checked)}
                      />
                      <div className="label">위 내용을 이해했고, 비-로컬 프록시 URL을 허용합니다. (위험)</div>
                    </label>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="btn" onClick={enableNonLocalProxyUrl} disabled={!ackNonLocalProxyUrl}>
                        허용하기
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {settings.allowNonLocalProxyUrl && (
                <div className="notice danger" style={{ gridColumn: '1 / -1', margin: '0 0 8px' }}>
                  <div className="notice-title">비-로컬 프록시 URL 허용됨 (위험)</div>
                  <div className="notice-body">
                    비-로컬 호스트로 프록시를 호출할 수 있습니다. 필요하지 않다면 끄는 것을 권장합니다.
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="btn" onClick={disableNonLocalProxyUrl}>
                        끄기
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <div className="label">Local Proxy Token (DCBOT_PROXY_TOKEN)</div>
                {missingProxyToken && (
                  <div className="notice danger" style={{ margin: '8px 0' }}>
                    로컬 프록시 서버가 토큰 인증을 사용하면(`/api/answer`), 이 값이 비어 있으면 호출이 실패합니다. `server/.env`의
                    `DCBOT_PROXY_TOKEN`과 동일한 값을 입력하세요.
                  </div>
                )}
                <div className="row">
                  <input
                    type={showProxyToken ? 'text' : 'password'}
                    value={proxyToken}
                    onChange={(e) => {
                      setProxyToken(e.target.value);
                      setProxyTokenMessage(null);
                    }}
                    placeholder="set a long random token"
                  />
                  <button className="btn" onClick={() => setShowProxyToken((v) => !v)}>
                    {showProxyToken ? '숨김' : '표시'}
                  </button>
                  <button className="btn" onClick={saveProxyToken}>
                    저장
                  </button>
                  <button className="btn" onClick={clearProxyToken}>
                    삭제
                  </button>
                </div>
                {proxyTokenMessage && <div className="muted" style={{ marginTop: 6 }}>{proxyTokenMessage}</div>}
              </div>

              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <div className="label">로컬 프록시 테스트(무과금)</div>
                <div className="row">
                  <button className="btn" onClick={testLocalProxy}>
                    Test local proxy
                  </button>
                  {proxyTestMessage && <div className="muted">{proxyTestMessage}</div>}
                </div>
              </div>
            </>
          ) : settings.providerMode === 'openai_direct' ? (
            <>
              <label className="field" style={{ gridColumn: '1 / -1' }}>
                <div className="label">Direct API Base URL (OpenAI-compatible)</div>
                <input
                  value={settings.directApiBaseUrl}
                  onChange={(e) => update('directApiBaseUrl', e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
                <div className="muted" style={{ marginTop: 6 }}>
                  예: <b>https://api.openai.com/v1</b>, <b>https://openrouter.ai/api/v1</b>, <b>https://api.groq.com/openai/v1</b>
                </div>
              </label>

              <label className="field">
                <div className="label">Direct API Type</div>
                <select value={settings.directApiType} onChange={(e) => update('directApiType', e.target.value as Settings['directApiType'])}>
                  <option value="auto">auto (responses → chat_completions)</option>
                  <option value="responses">responses</option>
                  <option value="chat_completions">chat_completions</option>
                </select>
              </label>

              <div className="field">
                <div className="label">API Key (Bearer)</div>
              {!settings.allowBrowserKeyStorage && (
                <div className="notice danger" style={{ margin: '8px 0' }}>
                  <div className="notice-title">키 저장 차단됨</div>
                  <div className="notice-body">
                    <ul style={{ margin: '6px 0 10px', paddingLeft: 18 }}>
                      <li>브라우저/확장 저장소에 키를 보관하면 유출 위험이 있습니다.</li>
                      <li>가능하면 local_proxy 모드를 권장합니다.</li>
                      <li>허용 시 과금/계정 리스크는 사용자 책임입니다.</li>
                    </ul>
                    <label className="field check" style={{ margin: 0 }}>
                      <input type="checkbox" checked={ackBrowserKeyStorage} onChange={(e) => setAckBrowserKeyStorage(e.target.checked)} />
                      <div className="label">위 내용을 이해했고, 이 브라우저에 키를 저장하는 것을 허용합니다.</div>
                    </label>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="btn" onClick={enableBrowserKeyStorage} disabled={!ackBrowserKeyStorage}>
                        허용하기
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="row">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setAvailableModels(null);
                    setModelListMessage(null);
                    setSaveState('idle');
                    setSaveMessage(null);
                  }}
                  placeholder="sk-..."
                  disabled={!canUseDirectKey}
                />
                <button className="btn" onClick={() => setShowKey((v) => !v)} disabled={!canUseDirectKey}>
                  {showKey ? '숨김' : '표시'}
                </button>
                <button className="btn" onClick={clearKey}>
                  삭제
                </button>
                <button className="btn" onClick={testKey} disabled={!canUseDirectKey}>
                  API 테스트
                </button>
              </div>
              {testMessage && <div className="muted" style={{ marginTop: 6 }}>{testMessage}</div>}
              </div>
            </>
          ) : (
            <>
              <div className="notice" style={{ gridColumn: '1 / -1', margin: '0 0 8px' }}>
                <div className="notice-title">Gemini API (Google)</div>
                <div className="notice-body">
                  Google Gemini API를 사용합니다. 모델은 예를 들어 <b>gemini-2.0-flash</b> 같은 값을 사용하세요.
                </div>
              </div>

              <div className="field">
                <div className="label">Google API Key (x-goog-api-key)</div>
                {!settings.allowBrowserKeyStorage && (
                  <div className="notice danger" style={{ margin: '8px 0' }}>
                    <div className="notice-title">키 저장 차단됨</div>
                    <div className="notice-body">
                      <ul style={{ margin: '6px 0 10px', paddingLeft: 18 }}>
                        <li>브라우저/확장 저장소에 키를 보관하면 유출 위험이 있습니다.</li>
                        <li>가능하면 local_proxy 모드를 권장합니다.</li>
                        <li>허용 시 과금/계정 리스크는 사용자 책임입니다.</li>
                      </ul>
                      <label className="field check" style={{ margin: 0 }}>
                        <input type="checkbox" checked={ackBrowserKeyStorage} onChange={(e) => setAckBrowserKeyStorage(e.target.checked)} />
                        <div className="label">위 내용을 이해했고, 이 브라우저에 키를 저장하는 것을 허용합니다.</div>
                      </label>
                      <div className="row" style={{ marginTop: 8 }}>
                        <button className="btn" onClick={enableBrowserKeyStorage} disabled={!ackBrowserKeyStorage}>
                          허용하기
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="row">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setAvailableModels(null);
                      setModelListMessage(null);
                      setSaveState('idle');
                      setSaveMessage(null);
                    }}
                    placeholder="AIza..."
                    disabled={!canUseDirectKey}
                  />
                  <button className="btn" onClick={() => setShowKey((v) => !v)} disabled={!canUseDirectKey}>
                    {showKey ? '숨김' : '표시'}
                  </button>
                  <button className="btn" onClick={clearKey}>
                    삭제
                  </button>
                  <button className="btn" onClick={testKey} disabled={!canUseDirectKey}>
                    API 테스트
                  </button>
                </div>
                {testMessage && <div className="muted" style={{ marginTop: 6 }}>{testMessage}</div>}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">모델/출력</h2>
        <div className="grid">
          <label className="field">
            <div className="label">Model</div>
            <input value={settings.model} onChange={(e) => update('model', e.target.value)} />
          </label>

          {isDirectProvider && (
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <div className="label">사용 가능한 모델</div>
              <div className="row">
                <button className="btn" onClick={fetchModelList} disabled={!canFetchModelList}>
                  모델 목록 불러오기
                </button>
                {modelListMessage && <div className="muted">{modelListMessage}</div>}
              </div>
              {availableModels && availableModels.length > 0 && (
                <select
                  value={modelSelectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) update('model', v);
                  }}
                  style={{ marginTop: 6 }}
                >
                  <option value="">(목록에서 선택하면 Model에 적용)</option>
                  {availableModels.slice(0, 200).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              {availableModels && availableModels.length === 0 && (
                <div className="muted" style={{ marginTop: 6 }}>
                  모델 목록이 비어있습니다.
                </div>
              )}
              {!settings.allowBrowserKeyStorage && (
                <div className="muted" style={{ marginTop: 6 }}>
                  “브라우저 키 저장 허용”을 켜면 모델 목록을 불러올 수 있어요.
                </div>
              )}
            </div>
          )}

          <label className="field">
            <div className="label">Reasoning Effort</div>
            <select value={settings.reasoningEffort} onChange={(e) => update('reasoningEffort', e.target.value as Settings['reasoningEffort'])}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>

          <label className="field">
            <div className="label">최대 답변 글자수</div>
            <input
              type="number"
              value={settings.maxAnswerChars}
              min={120}
              max={400}
              onChange={(e) => update('maxAnswerChars', Math.max(120, Math.min(400, Number(e.target.value || 0))))}
            />
            <div className="muted" style={{ marginTop: 6 }}>
              디시 댓글 입력칸 제한 때문에 최대 400자까지만 지원합니다.
            </div>
          </label>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <div className="label">링크 첨부</div>
            <div className="muted">답글에 링크(URL)를 첨부하지 않습니다.</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">인스트럭션(QA)</h2>
        <div className="grid">
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <div className="label">추가 지침 (선택)</div>
            <textarea
              value={settings.qaUserInstructions}
              rows={6}
              placeholder={'예) 반말로 짧게, 디시 말투로 대답해줘\n예) 너무 정색하지 말고 가볍게'}
              onChange={(e) => update('qaUserInstructions', e.target.value)}
            />
            <div className="muted" style={{ marginTop: 6 }}>
              여기에 적은 내용이 QA 답변 생성 시 인스트럭션에 추가됩니다. (단, 글자수 제한/@/URL 금지는 강제 적용)
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => update('qaUserInstructions', '')} disabled={!settings.qaUserInstructions.trim()}>
                초기화
              </button>
            </div>
          </label>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">검색</h2>
        <div className="grid">
          <label className="field check">
            <input type="checkbox" checked={settings.searchEnabled} onChange={(e) => update('searchEnabled', e.target.checked)} />
            <div className="label">내부 검색 사용</div>
          </label>

          <label className="field">
            <div className="label">검색 결과 개수</div>
            <input type="number" value={settings.searchLimit} onChange={(e) => update('searchLimit', Math.max(0, Math.min(10, Number(e.target.value || 0))))} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">동작</h2>
        <div className="grid">
          <label className="field check">
            <input type="checkbox" checked={settings.autoReply} onChange={(e) => update('autoReply', e.target.checked)} />
            <div className="label">자동 답변 생성</div>
          </label>

          <label className="field check">
            <input type="checkbox" checked={settings.autoSubmit} onChange={(e) => update('autoSubmit', e.target.checked)} />
            <div className="label">자동 등록 (위험)</div>
          </label>

          <label className="field check">
            <input type="checkbox" checked={settings.onlyMyTrigger} onChange={(e) => update('onlyMyTrigger', e.target.checked)} />
            <div className="label">내 댓글에서만 트리거 허용 (권장)</div>
          </label>

          <label className="field">
            <div className="label">쿨다운(초)</div>
            <input type="number" value={settings.cooldownSec} onChange={(e) => update('cooldownSec', Math.max(0, Math.min(3600, Number(e.target.value || 0))))} />
          </label>

          <label className="field">
            <div className="label">동시 생성 제한</div>
            <input
              type="number"
              value={settings.maxConcurrentGenerations}
              onChange={(e) => update('maxConcurrentGenerations', Math.max(1, Math.min(5, Number(e.target.value || 1))))}
            />
          </label>

          <label className="field">
            <div className="label">분당 생성 제한</div>
            <input
              type="number"
              value={settings.maxGenerationsPerMinute}
              onChange={(e) => update('maxGenerationsPerMinute', Math.max(1, Math.min(60, Number(e.target.value || 1))))}
            />
          </label>

          {settings.autoSubmit && (
            <div className="notice danger" style={{ gridColumn: '1 / -1' }}>
              자동 등록을 켜면 의도치 않은 댓글 등록이 발생할 수 있습니다. 또한 “자동등록방지”가 감지되면 자동 등록은 실행하지 않습니다.
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">디버그</h2>
        <div className="grid">
          <label className="field check">
            <input type="checkbox" checked={settings.debug} onChange={(e) => update('debug', e.target.checked)} />
            <div className="label">debug 모드</div>
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-title-row">
          <h2 className="card-title">오류 로그</h2>
          <div className="row">
            <button className="btn" onClick={refreshLogs}>
              새로고침
            </button>
            <button className="btn" onClick={clearLogs}>
              지우기
            </button>
            <button className="btn" onClick={copyRedactedLogJson} disabled={errorLog.length === 0 && !lastError}>
              Copy redacted JSON
            </button>
            <button className="btn" onClick={downloadRedactedLogJson} disabled={errorLog.length === 0 && !lastError}>
              Download JSON
            </button>
          </div>
        </div>
        {exportMessage && <div className="muted">{exportMessage}</div>}
        {lastError && <div className="muted">최근 에러: {lastError}</div>}
        {errorLog.length === 0 ? (
          <div className="muted" style={{ marginTop: 8 }}>로그 없음</div>
        ) : (
          <ul className="log">
            {errorLog
              .slice()
              .reverse()
              .map((e, idx) => (
                <li key={idx} className="log-item">
                  <div className="log-top">
                    <span className="log-scope">{e.scope}</span>
                    <span className="log-ts">{new Date(e.ts).toLocaleString()}</span>
                  </div>
                  <div className="log-msg">{e.message}</div>
                  {e.detail && <pre className="log-detail">{e.detail}</pre>}
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
