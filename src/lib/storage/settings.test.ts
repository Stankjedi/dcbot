import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '@/lib/storage/settings';

describe('normalizeSettings', () => {
  it('falls back to defaults for missing input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numeric fields and validates enums', () => {
    const normalized = normalizeSettings({
      maxAnswerChars: -10,
      searchLimit: 999,
      cooldownSec: -1,
      maxConcurrentGenerations: 999,
      maxGenerationsPerMinute: 0,
      reasoningEffort: 'nope',
      providerMode: 'nope',
      directApiType: 'nope',
    });

    expect(normalized.maxAnswerChars).toBeGreaterThanOrEqual(120);
    expect(normalized.searchLimit).toBeLessThanOrEqual(10);
    expect(normalized.cooldownSec).toBeGreaterThanOrEqual(0);
    expect(normalized.maxConcurrentGenerations).toBeLessThanOrEqual(5);
    expect(normalized.maxGenerationsPerMinute).toBeGreaterThanOrEqual(1);
    expect(['low', 'medium', 'high']).toContain(normalized.reasoningEffort);
    expect(['openai_direct', 'google_gemini', 'local_proxy']).toContain(normalized.providerMode);
    expect(['auto', 'responses', 'chat_completions']).toContain(normalized.directApiType);
  });

  it('respects boolean flags with defaults', () => {
    const normalized = normalizeSettings({ allowBrowserKeyStorage: true, includeSources: false });
    expect(normalized.allowBrowserKeyStorage).toBe(true);
    expect(normalized.includeSources).toBe(false);
  });

  it('defaults to blocking non-local proxy urls', () => {
    expect(DEFAULT_SETTINGS.allowNonLocalProxyUrl).toBe(false);

    const normalized = normalizeSettings({ allowNonLocalProxyUrl: true });
    expect(normalized.allowNonLocalProxyUrl).toBe(true);

    const normalizedInvalid = normalizeSettings({ allowNonLocalProxyUrl: 'true' });
    expect(normalizedInvalid.allowNonLocalProxyUrl).toBe(false);
  });

  it('defaults directApiBaseUrl and supports directApiType', () => {
    expect(DEFAULT_SETTINGS.directApiBaseUrl).toContain('openai.com');
    expect(DEFAULT_SETTINGS.directApiType).toBe('auto');

    const normalized = normalizeSettings({ directApiBaseUrl: 'https://example.com/v1', directApiType: 'responses' });
    expect(normalized.directApiBaseUrl).toBe('https://example.com/v1');
    expect(normalized.directApiType).toBe('responses');
  });
});
