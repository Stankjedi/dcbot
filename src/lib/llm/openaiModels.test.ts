import { describe, expect, it } from 'vitest';
import { extractOpenAiModelIds } from '@/lib/llm/openaiModels';

describe('extractOpenAiModelIds', () => {
  it('extracts unique model ids from data[].id', () => {
    const json = { data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1-mini' }, { id: 'gpt-4o-mini' }] };
    expect(extractOpenAiModelIds(json)).toEqual(['gpt-4.1-mini', 'gpt-4o-mini']);
  });
});

