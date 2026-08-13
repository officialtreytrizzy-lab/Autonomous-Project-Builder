import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../src/lib/builder.ts', import.meta.url), 'utf8');
const analyzeRoute = readFileSync(new URL('../src/app/api/analyze/route.ts', import.meta.url), 'utf8');
const startRoute = readFileSync(new URL('../src/app/api/builds/start/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../../../../safe-computer-claude-gateway/server.mjs', import.meta.url), 'utf8');

test('local deployment is supported by shared contract and API schemas', () => {
  assert.match(builder, /deployment\?: 'local' \| 'vercel' \| 'none'/);
  assert.match(analyzeRoute, /z\.enum\(\['local', 'vercel', 'none'\]\)\.default\('local'\)/);
  assert.match(startRoute, /z\.enum\(\['local', 'vercel', 'none'\]\)\.default\('local'\)/);
});

test('repository is optional for private local builds', () => {
  assert.match(builder, /No remote repository selected\. The project will remain in the private local workspace on Computer 2\./);
  assert.doesNotMatch(builder, /A repository is required before implementation can be persisted/);
  assert.match(page, /GitHub repository \(optional\)/);
  assert.match(page, /Leave blank to keep this build local/);
});

test('local deployment is the visible default', () => {
  assert.match(page, /deployment: 'local'/);
  assert.match(page, /<option value="local">Private local<\/option>/);
});

test('builder exposes an executable start path, not analysis-only', () => {
  assert.match(page, /async function startBuild\(\)/);
  assert.match(page, /fetch\('\/api\/builds\/start'/);
  assert.match(page, /autonomous-builder-active-job/);
  assert.match(startRoute, /job_submit/);
  assert.match(startRoute, /plan_execute/);
});

test('active build panel renders live telemetry, controls and logs', () => {
  assert.match(page, /active-build-panel/);
  assert.match(page, /Live Telemetry Feed/);
  assert.match(page, /Self-Healing: Active/);
  assert.match(page, /pauseBuild/);
  assert.match(page, /resumeBuild/);
  assert.match(page, /cancelBuild/);
  assert.match(page, /pollStatus/);
});

test('autonomy policy preserves recoverable-error continuation', () => {
  assert.match(builder, /continue through recoverable failures and non-blocking missing ingredients/i);
});

test('gateway injects internal UPSTREAM_MCP_AUTH_TOKEN when forwarding to Computer 2', () => {
  assert.match(gateway, /const UPSTREAM_MCP_AUTH_TOKEN = process\.env\.UPSTREAM_MCP_AUTH_TOKEN/);
  assert.match(gateway, /headers\.set\('authorization', `Bearer \${UPSTREAM_MCP_AUTH_TOKEN}`\)/);
});

test('inputs enforce 16px font-size for iOS viewport auto-zoom prevention', () => {
  assert.match(css, /input, textarea, select \{[^}]*font-size: 16px;/);
});
