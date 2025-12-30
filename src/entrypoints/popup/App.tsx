import { useEffect, useState } from 'react';
import { getDcbotService } from '@/lib/rpc/dcbot';
import type { Settings } from '@/lib/storage/settings';
import type { ErrorLogEntry } from '@/lib/storage/localState';

type Health = { ok: true; version: string } | { ok: false; error: string };
type ProxyHealth = { ok: true } | { ok: false; error: string };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label = 'Timeout'): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(label)), timeoutMs);
    promise.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([]);
  const [proxyHealth, setProxyHealth] = useState<ProxyHealth | null>(null);
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const [isDcinside, setIsDcinside] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    (async () => {
      // 현재 탭이 디시인사이드인지 확인
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url ?? '';
        const isDc = url.includes('dcinside.com');
        setIsDcinside(isDc);
      } catch {
        setIsDcinside(false);
      }

      try {
        const svc = getDcbotService();
        const settingsData = await withTimeout(svc.getSettings(), 5000, 'Background not responding');
        setSettings(settingsData);
        setHealth(await withTimeout(svc.health(), 5000, 'Background not responding'));
        setLastError(await withTimeout(svc.getLastError(), 5000, 'Background not responding'));

        // 에러 로그 가져오기
        try {
          const logs = await withTimeout(svc.getErrorLog(), 5000, 'Timeout');
          setErrorLogs(logs.slice(-5)); // 최근 5개만
        } catch {
          // ignore
        }

        if (settingsData.providerMode === 'local_proxy') {
          const base = (settingsData.localProxyUrl ?? 'http://127.0.0.1:8787').trim();
          setProxyUrl(base);

          try {
            const healthUrl = (() => {
              try {
                const url = new URL(base);
                return new URL('/health', url).toString();
              } catch {
                return 'http://127.0.0.1:8787/health';
              }
            })();

            const res = await fetch(healthUrl, { method: 'GET' });
            const json = (await res.json().catch(() => null)) as any;
            if (!res.ok) {
              const msg = (typeof json?.error === 'string' && json.error) || `HTTP ${res.status}`;
              setProxyHealth({ ok: false, error: msg });
            } else if (json?.ok === true) {
              setProxyHealth({ ok: true });
            } else {
              setProxyHealth({ ok: false, error: 'Invalid /health response' });
            }
          } catch (error) {
            setProxyHealth({ ok: false, error: String(error) });
          }
        } else {
          setProxyUrl(null);
          setProxyHealth(null);
        }
      } catch (error) {
        setHealth({ ok: false, error: String(error) });
      }
    })();
  }, []);

  return (
    <div className="wrap">
      <div className="title">DCInside 디시봇</div>
      <div className="row">
        <span className="label">현재 페이지</span>
        <span className="value">
          {isDcinside == null ? '확인 중…' : isDcinside ? '✅ 디시인사이드' : '❌ 디시인사이드 아님'}
        </span>
      </div>
      <div className="row">
        <span className="label">상태</span>
        <span className="value">
          {health == null ? '확인 중…' : health.ok ? `✅ 정상 (${health.version})` : `❌ ${health.error}`}
        </span>
      </div>
      {settings && (
        <>
          <div className="row">
            <span className="label">Provider</span>
            <span className="value">{settings.providerMode}</span>
          </div>
          <div className="row">
            <span className="label">자동 답글</span>
            <span className="value">
              {settings.autoReply ? '✅ ON' : '❌ OFF'} / 자동 등록: {settings.autoSubmit ? '✅ ON' : '❌ OFF'}
            </span>
          </div>
        </>
      )}
      <div className="row">
        <span className="label">최근 에러</span>
        <span className="value">{lastError ?? '없음'}</span>
      </div>
      {proxyUrl && (
        <div className="row">
          <span className="label">로컬 프록시</span>
          <span className="value">
            {proxyHealth == null ? '확인 중…' : proxyHealth.ok ? `✅ 정상` : `❌ ${proxyHealth.error}`}
          </span>
        </div>
      )}
      {errorLogs.length > 0 && (
        <div className="row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <span className="label">에러 로그 (최근 {errorLogs.length}개)</span>
          <div style={{ fontSize: '10px', maxHeight: '80px', overflow: 'auto', width: '100%', marginTop: '4px' }}>
            {errorLogs.map((log, i) => (
              <div key={i} style={{ borderBottom: '1px solid #eee', padding: '2px 0' }}>
                <strong>{log.scope}</strong>: {log.message}
                {log.detail && <div style={{ color: '#666' }}>{log.detail.slice(0, 100)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="actions">
        <button className="btn" onClick={() => {
          const optionsUrl = browser.runtime.getURL('/options.html');
          window.open(optionsUrl, 'dcbot-options', 'width=600,height=700,popup=yes');
        }}>
          옵션 열기
        </button>
      </div>
    </div>
  );
}
