import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BuildStore, recoverWorkspaceBuilds, redactSecrets } from '../src/lib/build-store.ts';

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

test('workspace manifest restores a build after the SQLite state file is lost', () => {
  const directory = mkdtempSync(join(tmpdir(), 'builder-recovery-'));
  const projectsRoot = join(directory, 'projects');
  const workspace = join(projectsRoot, 'app-one');
  const control = join(workspace, '.builder');
  const database = join(directory, 'state.db');
  mkdirSync(control, { recursive: true });
  writeFileSync(join(control, 'request.md'), 'GOAL\nRecover me\n\nPROJECT NAME\nRecovery App\n', 'utf8');

  const first = new BuildStore(database);
  const created = first.create({ request: { name: 'Recovery App', objective: 'Recover me', deployment: 'local' }, analysis: { canContinue: true }, workspace });
  first.update(created.id, { status: 'running', currentStage: 'execution', currentStep: 'Building' });
  assert.equal(existsSync(join(control, 'build-record.json')), true);
  first.close();
  rmSync(database, { force: true });
  rmSync(`${database}-wal`, { force: true });
  rmSync(`${database}-shm`, { force: true });

  const second = new BuildStore(database);
  try {
    const recovered = recoverWorkspaceBuilds(second, projectsRoot);
    assert.deepEqual(recovered, [created.id]);
    assert.equal(second.get(created.id)?.status, 'running');
    assert.equal(second.get(created.id)?.workspace, workspace);
  } finally {
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy ChatGPT completion evidence is imported when no build manifest exists', () => {
  const directory = mkdtempSync(join(tmpdir(), 'builder-legacy-recovery-'));
  const projectsRoot = join(directory, 'projects');
  const workspace = join(projectsRoot, 'legacy-app');
  const control = join(workspace, '.builder');
  const database = join(directory, 'state.db');
  mkdirSync(control, { recursive: true });
  const buildId = 'build-11111111-2222-3333-4444-555555555555';
  writeFileSync(join(control, 'request.md'), 'AUTONOMOUS PROJECT BUILDER CHATGPT HANDOFF\n\nGOAL\nRecover the legacy build\n\nPROJECT NAME\nLegacy App\n', 'utf8');
  writeFileSync(join(control, 'chatgpt-handoff.json'), JSON.stringify({ buildId, url: 'https://chatgpt.com/c/test', submittedAt: '2026-08-14T00:00:00.000Z' }), 'utf8');
  writeFileSync(join(control, 'completion.json'), JSON.stringify({ status: 'complete', appUrl: 'http://127.0.0.1:3208', verification: [{ name: 'http', status: 'passed', detail: 'ok' }], repairs: [], result: { summary: 'done' } }), 'utf8');

  const store = new BuildStore(database);
  try {
    assert.deepEqual(recoverWorkspaceBuilds(store, projectsRoot), [buildId]);
    const recovered = store.get(buildId);
    assert.equal(recovered?.status, 'complete');
    assert.equal(recovered?.request.name, 'Legacy App');
    assert.equal(recovered?.requestedGoal, 'Recover the legacy build');
    assert.equal(recovered?.appUrl, 'http://127.0.0.1:3208');
    assert.deepEqual(recovered?.analysis.ingredients, []);
    assert.deepEqual(recovered?.analysis.steps, []);
    assert.equal(recovered?.analysis.canContinue, true);
    assert.equal(existsSync(join(control, 'build-record.json')), true);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});