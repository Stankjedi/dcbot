import { describe, expect, it } from 'vitest';
import { extractGeminiModelNames, extractGeminiText } from '@/lib/llm/googleGemini';

describe('extractGeminiText', () => {
  it('extracts from candidates[0].content.parts[].text', () => {
    const json = {
      candidates: [{ content: { parts: [{ text: 'hello' }, { text: 'world' }] } }],
    };
    expect(extractGeminiText(json)).toBe('hello\nworld');
  });

  it('returns null for invalid payloads', () => {
    expect(extractGeminiText(null)).toBeNull();
    expect(extractGeminiText({})).toBeNull();
    expect(extractGeminiText({ candidates: [] })).toBeNull();
    expect(extractGeminiText({ candidates: [{ content: { parts: [] } }] })).toBeNull();
  });
});

describe('extractGeminiModelNames', () => {
  it('extracts model names and strips models/ prefix', () => {
    const json = {
      models: [
        { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] },
      ],
    };
    expect(extractGeminiModelNames(json)).toEqual(['gemini-2.0-flash', 'gemini-1.5-pro']);
  });
});

