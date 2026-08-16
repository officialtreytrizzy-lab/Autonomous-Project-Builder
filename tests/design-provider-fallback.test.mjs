import assert from 'node:assert/strict';
import test from 'node:test';

import { callDesignDirector } from '../src/lib/ai/design-provider.ts';

test('design director calls Gemini Flash generateContent by default', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'BUILDER_DESIGN_MODEL', 'BUILDER_DESIGN_FALLBACK_MODEL'];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.GEMINI_API_KEY = 'TEST_GCP_API_KEY_PLACEHOLDER';
  process.env.BUILDER_DESIGN_MODEL = 'gemini-flash-latest';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body || '{}'));
    calls.push({ url: String(url), options, body });
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: 'GEMINI_DESIGN_OK' }],
        },
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const text = await callDesignDirector({ messages: [{ role: 'user', content: 'Design this' }], maxTokens: 64 });
    assert.equal(text, 'GEMINI_DESIGN_OK');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-flash-latest:generateContent/);
    assert.equal(calls[0].options.headers['X-goog-api-key'], 'TEST_GCP_API_KEY_PLACEHOLDER');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('design director falls through from throttled OpenRouter free routes to Groq vision', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GROQ_VISION_MODEL', 'BUILDER_DESIGN_MODEL', 'BUILDER_DESIGN_FALLBACK_MODEL'];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.GROQ_API_KEY = 'groq-test-key';
  process.env.GROQ_VISION_MODEL = 'qwen/qwen3.6-27b';
  process.env.BUILDER_DESIGN_MODEL = 'google/gemma-4-26b-a4b-it:free';
  process.env.BUILDER_DESIGN_FALLBACK_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body || '{}'));
    calls.push({ url: String(url), body });
    if (String(url).includes('openrouter.ai')) {
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    assert.match(String(url), /api\.groq\.com/);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'GROQ_FALLBACK_OK' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const text = await callDesignDirector({ messages: [{ role: 'user', content: 'Design this' }], maxTokens: 64 });
    assert.equal(text, 'GROQ_FALLBACK_OK');
    assert.ok(calls.length >= 2);
    assert.match(calls[0].url, /openrouter\.ai/);
    const groqCall = calls.at(-1);
    assert.match(groqCall.url, /api\.groq\.com/);
    assert.equal(groqCall.body.model, 'qwen/qwen3.6-27b');
    assert.equal(groqCall.body.reasoning_format, 'hidden');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
