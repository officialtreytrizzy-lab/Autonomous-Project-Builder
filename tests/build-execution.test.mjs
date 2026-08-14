import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classifyBuildError,
  prepareBuildWorkspace,
  validateCompletionEvidence,
} from '../src/lib/build-execution.ts';

test('execution preparation keeps the goal in a file rather than the shell command', () => {
  const root = mkdtempSync(join(tmpdir(), 'builder-exec-'));
  try {
    const prepared = prepareBuildWorkspace({
      root,
      buildId: 'build-safe-1',
      port: 3241,
      request: { name: 'Local E2E Smoke App', objective: 'Render LOCAL E2E PASS', deployment: 'local', backend: 'none', workflow: 'none' },
      steps: [{ id: 'verify', title: 'Verify', target: 'computer-2', status: 'ready', reason: 'Gate' }],
    });

    assert.equal(prepared.command.includes('LOCAL E2E PASS'), false);
    assert.match(prepared.command, /launch-build\.ps1/);
    assert.match(readFileSync(prepared.promptPath, 'utf8'), /LOCAL E2E PASS/);
    assert.match(readFileSync(prepared.promptPath, 'utf8'), /Do not use GitHub or Vercel/);
    const worker = readFileSync(prepared.scriptPath, 'utf8');
    const bundledWorker = readFileSync(join(process.cwd(), 'workers', 'build-worker.mjs'), 'utf8');
    assert.match(readFileSync(prepared.promptPath, 'utf8'), /connected Computer 2 MCP/);
    assert.match(worker, /build-worker\.mjs/);
    assert.match(worker, /worker\.pid/);
    assert.match(bundledWorker, /authenticated_chrome_status/);
    assert.match(bundledWorker, /authenticated_chrome_navigate/);
    assert.match(bundledWorker, /authenticated_chrome_snapshot/);
    assert.match(bundledWorker, /authenticated_chrome_select_tab/);
    assert.match(bundledWorker, /authenticated_chrome_type/);
    assert.match(bundledWorker, /authenticated_chrome_press_key/);
    assert.match(bundledWorker, /Selected browser tab drifted away from the ChatGPT build thread/);
    assert.equal(/codex(?:\.cmd|\.exe)?\s+exec/i.test(bundledWorker), false);
    assert.equal(/(?:gemini\.cmd|gemini\.exe)\s/i.test(bundledWorker), false);
    assert.equal(prepared.worker, 'chatgpt-mcp');
    assert.match(readFileSync(prepared.launcherPath, 'utf8'), /Register-ScheduledTask/);
    assert.match(readFileSync(prepared.launcherPath, 'utf8'), /USERDOMAIN\\\$env:USERNAME/);
    assert.equal(prepared.workspace.startsWith(root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion requires every production gate to pass or be explicitly inapplicable', () => {
  const checks = ['dependencies', 'lint', 'typecheck', 'unit-tests', 'integration-tests', 'production-build', 'critical-flows', 'runtime', 'http', 'placeholder-audit']
    .map((name) => ({ name, status: 'passed' }));
  assert.equal(validateCompletionEvidence({ status: 'complete', appUrl: 'http://127.0.0.1:3241', verification: checks }).ok, true);

  const failed = checks.map((check) => check.name === 'production-build' ? { ...check, status: 'failed' } : check);
  const result = validateCompletionEvidence({ status: 'complete', appUrl: 'http://127.0.0.1:3241', verification: failed });
  assert.equal(result.ok, false);
  assert.match(result.reason, /production-build/);
});

test('execution failures receive actionable classifications', () => {
  const cases = [
    ['ECONNREFUSED connecting to MCP', 'transient/network'],
    ['Streamable HTTP error: Method Not Allowed', 'transient/network'],
    ['401 Unauthorized', 'authentication'],
    ['429 too many requests', 'rate limit'],
    ['ChatGPT usage limit reached', 'rate limit'],
    ['Docker daemon unavailable', 'dependency unavailable'],
    ['Missing environment configuration', 'configuration'],
    ['Zod validation failed', 'validation'],
    ['TypeScript compile error TS2322', 'code/build error'],
    ['unit test failed', 'test failure'],
    ['authenticated Chrome bridge disconnected', 'browser bridge'],
    ['provider service outage', 'service outage'],
    ['credential must be provided by user', 'user-required input'],
    ['choose an irreversible billing plan', 'irreversible decision'],
    ['strange failure', 'unknown'],
  ];
  for (const [message, expected] of cases) assert.equal(classifyBuildError(message), expected, message);
});
