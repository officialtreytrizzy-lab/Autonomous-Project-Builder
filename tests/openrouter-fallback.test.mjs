import assert from 'node:assert/strict';
import test from 'node:test';

import { callOpenRouter } from '../src/lib/ai/openrouter.ts';

test('blank primary design completion automatically falls through to the free fallback', async () => {
  const originalFetch = globalThis.fetch;
  const beforeKey = process.env.OPENROUTER_API_KEY;
  const beforeFallback = process.env.BUILDER_DESIGN_FALLBACK_MODEL;
  const models = [];
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.BUILDER_DESIGN_FALLBACK_MODEL = 'google/gemma-4-31b-it:free';
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body || '{}'));
    models.push(body.model);
    const content = models.length === 1 ? '   ' : 'DESIGN_FALLBACK_OK';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await callOpenRouter({
      model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      messages: [{ role: 'user', content: 'test' }],
      maxTokens: 32,
    });
    assert.equal(result, 'DESIGN_FALLBACK_OK');
    assert.deepEqual(models, [
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'google/gemma-4-31b-it:free',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (beforeKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = beforeKey;
    if (beforeFallback === undefined) delete process.env.BUILDER_DESIGN_FALLBACK_MODEL; else process.env.BUILDER_DESIGN_FALLBACK_MODEL = beforeFallback;
  }
});
