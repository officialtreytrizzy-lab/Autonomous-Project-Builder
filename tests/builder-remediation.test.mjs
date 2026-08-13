import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

test('remediation: verifier.ts exports production verification with honest check reporting', () => {
  const verifier = readFileSync(new URL('../src/lib/verifier.ts', import.meta.url), 'utf8');
  assert.match(verifier, /export async function runProductionVerification/);
  assert.match(verifier, /category:\s*'syntax'\s*\|\s*'typecheck'\s*\|\s*'lint'\s*\|\s*'test'\s*\|\s*'build'\s*\|\s*'health'\s*\|\s*'ui'/);
  assert.match(verifier, /status:\s*'passed'\s*\|\s*'failed'\s*\|\s*'warning'\s*\|\s*'skipped'/);
  assert.match(verifier, /autoRepaired\?: boolean/);
  assert.match(verifier, /repairAttempts: number/);
  // Ensure honest failure reporting (no silent fake passes)
  assert.doesNotMatch(verifier, /Local build certification passed/);
});

test('remediation: computer2-mcp.ts includes retry, backoff, and fallback recovery engine', () => {
  const mcp = readFileSync(new URL('../src/lib/computer2-mcp.ts', import.meta.url), 'utf8');
  assert.match(mcp, /export async function callComputer2WithRetry/);
  assert.match(mcp, /export async function callComputer2WithFallback/);
  assert.match(mcp, /export function getRecoveryStats/);
  assert.match(mcp, /recoveryMemory/);
  assert.match(mcp, /recordRecovery/);
});

test('remediation: validator.ts produces honest red and blocking items without masking errors', () => {
  const validator = readFileSync(new URL('../src/lib/validator.ts', import.meta.url), 'utf8');
  assert.match(validator, /export async function inspectSystemResources/);
  assert.match(validator, /export async function validateIngredients/);
  assert.match(validator, /level:\s*'red'/);
  assert.match(validator, /blocking:\s*true/);
  // Verify error is not masked to ok: true
  assert.match(validator, /computer2Result = \{ ok: false/);
});

test('remediation: windmill.ts provides complete workflow dispatch client', () => {
  const windmill = readFileSync(new URL('../src/lib/windmill.ts', import.meta.url), 'utf8');
  assert.match(windmill, /export async function windmillHealth/);
  assert.match(windmill, /export async function runWindmillScript/);
  assert.match(windmill, /export async function runWindmillFlow/);
  assert.match(windmill, /export async function getWindmillJobStatus/);
  assert.match(windmill, /export async function cancelWindmillJob/);
  assert.match(windmill, /export async function listWindmillJobs/);
});

test('remediation: supabase-store.ts includes filesystem-backed persistence fallback', () => {
  const store = readFileSync(new URL('../src/lib/supabase-store.ts', import.meta.url), 'utf8');
  assert.match(store, /readLocalStore/);
  assert.match(store, /writeLocalStore/);
  assert.match(store, /BUILDER_STORE_DIR/);
  assert.match(store, /builds\.json/);
  assert.match(store, /export async function persistBuild/);
  assert.match(store, /export async function getPersistedBuild/);
  assert.match(store, /export async function listPersistedBuilds/);
});

test('remediation: page.tsx and css include separate Pause, Resume, Cancel controls and touch-action none', () => {
  const page = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  
  assert.match(page, /pauseBuild/);
  assert.match(page, /resumeBuild/);
  assert.match(page, /cancelBuild/);
  assert.match(page, /Started:/);
  assert.match(page, /healthStatus/);
  assert.match(page, /health-inline/);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /\.badge-paused/);
  assert.match(css, /\.btn-danger/);
  assert.match(css, /\.btn-primary/);
});

test('remediation: cancel route updates persistence store', () => {
  const cancel = readFileSync(new URL('../src/app/api/builds/cancel/route.ts', import.meta.url), 'utf8');
  assert.match(cancel, /persistBuild/);
  assert.match(cancel, /status:\s*'cancelled'/);
});

test('remediation: result route performs server-side verification before returning completed result', () => {
  const result = readFileSync(new URL('../src/app/api/builds/result/route.ts', import.meta.url), 'utf8');
  assert.match(result, /runProductionVerification/);
  assert.match(result, /verification:/);
});
