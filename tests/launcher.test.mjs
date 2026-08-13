import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('local launcher validates the reserved port and supervisor contract without exposing secrets', () => {
  const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'start-builder.ps1'), '-ValidateOnly'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.port, 3107);
  assert.equal(payload.computer2Url, 'http://127.0.0.1:3000/mcp');
  assert.equal(payload.supervised, true);
  assert.equal(payload.intakeWorker.endsWith('dist-worker\\intake-worker.mjs'), true);
  assert.equal(result.stdout.includes('MCP_AUTH_TOKEN='), false);
});
