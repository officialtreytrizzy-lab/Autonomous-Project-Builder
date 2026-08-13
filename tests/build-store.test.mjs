import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BuildStore, redactSecrets } from '../src/lib/build-store.ts';

function withStore(run) {
  const directory = mkdtempSync(join(tmpdir(), 'builder-store-'));
  const database = join(directory, 'state.db');
  const store = new BuildStore(database);
  return Promise.resolve(run(store, database)).finally(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
}

test('build state survives a new store instance', () => withStore((store, database) => {
  const created = store.create({
    request: { name: 'Persistent App', objective: 'Build it', deployment: 'local' },
    analysis: { canContinue: true },
    workspace: 'C:\\Projects\\persistent-app',
  });
  store.update(created.id, { planId: 'plan-1', jobId: 'job-1', status: 'running', currentStage: 'execution' });
  store.close();

  const reopened = new BuildStore(database);
  try {
    const restored = reopened.get(created.id);
    assert.equal(restored?.jobId, 'job-1');
    assert.equal(restored?.status, 'running');
    assert.equal(restored?.workspace, 'C:\\Projects\\persistent-app');
    assert.equal(reopened.unfinished().length, 1);
  } finally {
    reopened.close();
  }
}));

test('history contains actual terminal and active builds newest first', () => withStore((store) => {
  const first = store.create({ request: { objective: 'one' }, analysis: {}, workspace: 'one' });
  const second = store.create({ request: { objective: 'two' }, analysis: {}, workspace: 'two' });
  store.update(first.id, { status: 'complete', finishedAt: new Date().toISOString() });
  store.update(second.id, { status: 'cancelled', finishedAt: new Date().toISOString() });

  const statuses = new Set(store.list().map((build) => build.status));
  assert.deepEqual(statuses, new Set(['complete', 'cancelled']));
}));

test('structured logs redact authorization, token, cookie and password values', () => withStore((store) => {
  const build = store.create({ request: { objective: 'secure' }, analysis: {}, workspace: 'secure' });
  store.appendLog(build.id, {
    step: 'connect',
    target: 'computer-2',
    tool: 'mcp',
    result: {
      authorization: 'Bearer abc123',
      nested: { MCP_AUTH_TOKEN: 'secret-token', cookie: 'session=private', password: 'hunter2' },
      message: 'Authorization: Bearer visible-token',
    },
  });

  const serialized = JSON.stringify(store.logs(build.id));
  assert.equal(serialized.includes('abc123'), false);
  assert.equal(serialized.includes('secret-token'), false);
  assert.equal(serialized.includes('session=private'), false);
  assert.equal(serialized.includes('hunter2'), false);
  assert.equal(serialized.includes('visible-token'), false);
  assert.match(serialized, /\[REDACTED\]/);
}));

test('redaction leaves ordinary build diagnostics intact', () => {
  assert.deepEqual(redactSecrets({ error: 'TypeScript failed in app/page.tsx', attempt: 2 }), {
    error: 'TypeScript failed in app/page.tsx',
    attempt: 2,
  });
});

test('legacy local no-backend records are normalized away from cloud routing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'builder-store-'));
  const databasePath = join(directory, 'state.db');
  const store = new BuildStore(databasePath);
  try {
    const build = store.create({
      request: { objective: 'local', deployment: 'local', backend: 'none' },
      workspace: directory,
      analysis: { ingredients: [{ id: 'backend', target: 'cloud', detail: 'No backend requested for this build.' }] },
    });
    const backend = store.get(build.id).analysis.ingredients.find((item) => item.id === 'backend');
    assert.equal(backend.target, 'computer-2');
    assert.match(backend.detail, /local build/i);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
