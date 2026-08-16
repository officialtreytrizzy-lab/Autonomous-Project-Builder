import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  assert.equal(payload.intakeWorker.endsWith(join('dist-worker', 'intake-worker.mjs')), true);
  assert.equal(result.stdout.includes('MCP_AUTH_TOKEN='), false);
});

test('local supervisor launches the standalone production server and stages static assets', () => {
  const supervisor = readFileSync(join(root, 'scripts', 'builder-supervisor.ps1'), 'utf8');
  assert.match(supervisor, /\.next_build\\standalone/);
  assert.match(supervisor, /Start-Process node\.exe/);
  assert.match(supervisor, /server\.js/);
  assert.match(supervisor, /\.next_build\\static/);
  assert.equal(/npm\.cmd.*run.*start/i.test(supervisor), false);
});
