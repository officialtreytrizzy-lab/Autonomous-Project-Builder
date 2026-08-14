import assert from 'node:assert/strict';
import test from 'node:test';

import { createOllamaVisionClient } from '../src/lib/intake/vision.ts';

test('local vision synthesizes a complete source-grounded build brief without leaking private paths', async () => {
  const requests = [];
  const client = createOllamaVisionClient({
    model: 'gemma3:4b',
    async fetchImpl(url, init) {
      requests.push({ url, init });
      return new Response(JSON.stringify({
        message: {
          content: JSON.stringify({
            brief: {
              outcome: 'Build a private local restaurant ordering application.',
              users: ['Restaurant guest'],
              flows: ['Guest confirms the order before payment.'],
              requirements: ['The home page displays LOCAL MULTIMODAL PASS.'],
              designDirection: ['Use the embedded cyan checkout interface as the visual reference.'],
              dataAndIntegrations: [],
              exclusions: ['No cloud deployment.'],
              acceptanceTests: ['The local production runtime returns HTTP 200.'],
              assumptions: [],
            },
            contradictions: ['Text says payment precedes confirmation, while the diagram puts confirmation first.'],
            uncertainties: [],
          }),
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await client.synthesize?.([{
    evidenceId: 'evidence-1', intakeId: 'intake-1', sourceId: 'source-1', revisionId: 'revision-1',
    page: 2, kind: 'diagram', content: 'Confirm order -> payment', relationships: ['confirmation precedes payment'],
    confidence: 0.98, processingMethod: 'local-vision', artifactPath: 'C:\\private\\project\\derived\\page-2.png',
    createdAt: '2026-08-13T00:00:00.000Z',
  }]);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:11434/api/chat');
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, 'gemma3:4b');
  assert.equal(body.stream, false);
  assert.equal(body.think, false);
  assert.equal(body.options.temperature, 0);
  assert.equal(body.options.num_predict, 1024);
  assert.match(body.messages[0].content, /equal first-class evidence/i);
  assert.match(body.messages[0].content, /confirmation precedes payment/i);
  assert.doesNotMatch(body.messages[0].content, /C:\\private/i);
  assert.equal(result.brief.flows[0], 'Guest confirms the order before payment.');
  assert.equal(result.contradictions.length, 1);
});

test('local vision honors the configured inference timeout', async () => {
  const client = createOllamaVisionClient({
    model: 'gemma3:4b',
    timeoutMs: 20,
    async fetchImpl(_url, init) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    },
  });

  const outcome = await Promise.race([
    client.inspect({ imagePath: 'package.json', page: 1, nativeText: '', requestOcr: false })
      .then(() => 'completed', (error) => error?.name || 'error'),
    new Promise((resolve) => setTimeout(() => resolve('not-aborted'), 250)),
  ]);
  assert.equal(outcome, 'TimeoutError');
});
