import assert from 'node:assert/strict';
import test from 'node:test';

import { routeAiTask } from '../src/lib/ai/router.ts';

function withEnv(values, run) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { return run(); }
  finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('implementation stays on ChatGPT by default while optional specialists are disconnected', () => withEnv({
  GEMINI_API_KEY: undefined,
  GOOGLE_API_KEY: undefined,
  OPENROUTER_API_KEY: undefined,
  BUILDER_QWEN_MULTIMODAL_ENDPOINT: undefined,
  BUILDER_NEEDLE_ENDPOINT: undefined,
}, () => {
  assert.equal(routeAiTask({ kind: 'implementation' }).primary.role, 'implementation-brain');
  assert.equal(routeAiTask({ kind: 'design' }).primary.role, 'implementation-brain');
  assert.equal(routeAiTask({ kind: 'visual-qa', hasImages: true }).primary.role, 'implementation-brain');
  assert.equal(routeAiTask({ kind: 'tool-dispatch' }).primary.role, 'implementation-brain');
  assert.equal(routeAiTask({ kind: 'audio-analysis' }).primary.role, 'audio-analysis');
}));

test('configured specialists take only their intended jobs', () => withEnv({
  GEMINI_API_KEY: 'test-key',
  OPENROUTER_API_KEY: 'test-key',
  BUILDER_QWEN_MULTIMODAL_ENDPOINT: 'http://qwen.local/v1',
  BUILDER_NEEDLE_ENDPOINT: 'http://127.0.0.1:3322',
}, () => {
  assert.equal(routeAiTask({ kind: 'design' }).primary.role, 'design');
  assert.equal(routeAiTask({ kind: 'visual-qa', hasImages: true }).primary.role, 'multimodal-worker');
  assert.equal(routeAiTask({ kind: 'tool-dispatch', complexity: 'low' }).primary.role, 'tool-router');
  assert.equal(routeAiTask({ kind: 'implementation' }).primary.role, 'implementation-brain');
  assert.equal(routeAiTask({ kind: 'audio-analysis' }).primary.role, 'audio-analysis');
}));
