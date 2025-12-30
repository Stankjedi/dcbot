import { describe, expect, it } from 'vitest';
import { extractOutputText } from '@/lib/llm/openaiResponses';

describe('extractOutputText', () => {
  it('extracts output_text', () => {
    expect(extractOutputText({ output_text: 'ok' })).toBe('ok');
  });

  it('extracts output[].content[].text', () => {
    const json = {
      output: [
        {
          content: [{ type: 'output_text', text: 'hello' }, { type: 'output_text', text: ' world' }],
        },
      ],
    };
    expect(extractOutputText(json)).toBe('hello world');
  });

  it('falls back to chat-like choices', () => {
    const json = { choices: [{ message: { content: 'a' } }, { message: { content: 'b' } }] };
    expect(extractOutputText(json)).toBe('a\nb');
  });

  it('returns null for empty/unknown payloads', () => {
    expect(extractOutputText({})).toBeNull();
    expect(extractOutputText(null)).toBeNull();
  });
});

