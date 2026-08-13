import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { probeService, summarizeReadiness } from '../src/lib/health.ts';

test('optional capability outages do not make the local builder unready', () => {
  const summary = summarizeReadiness({
    computer2: { ok: true },
    localRuntime: { ok: true },
    dockerGateway: { ok: false },
    windmill: { ok: false },
    authenticatedChrome: { ok: false },
  });

  assert.equal(summary.ready, true);
  assert.equal(summary.status, 'ready');
  assert.deepEqual(summary.degradedCapabilities.sort(), ['authenticatedChrome', 'dockerGateway', 'windmill']);
});

test('a Computer 2 outage fails core readiness', () => {
  const summary = summarizeReadiness({ computer2: { ok: false }, localRuntime: { ok: true } });
  assert.equal(summary.ready, false);
  assert.equal(summary.status, 'unavailable');
  assert.deepEqual(summary.unavailableCore, ['computer2']);
});

test('document vision stays optional globally but can be required for an active visual intake', () => {
  const services = {
    computer2: { ok: true },
    localRuntime: { ok: true },
    documentVision: { ok: false, detail: 'Recovery required' },
  };
  assert.equal(summarizeReadiness(services).ready, true);
  const intakeReadiness = summarizeReadiness(services, ['documentVision']);
  assert.equal(intakeReadiness.ready, false);
  assert.deepEqual(intakeReadiness.unavailableRequired, ['documentVision']);
});

test('gateway probes keep authorization server-side', async () => {
  let authorization = '';
  const server = createServer((request, response) => {
    authorization = String(request.headers.authorization || '');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const result = await probeService(`http://127.0.0.1:${address.port}/health`, { bearerToken: 'server-only-test-token' });
    assert.equal(result.ok, true);
    assert.equal(authorization, 'Bearer server-only-test-token');
    assert.equal(JSON.stringify(result).includes('server-only-test-token'), false);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
