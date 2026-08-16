import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('browser-facing health reports degradation in JSON without a failed resource response', () => {
  const route = readFileSync('src/app/api/health/route.ts', 'utf8');
  assert.match(route, /httpStatus:\s*readiness\.ready\s*\?\s*200\s*:\s*503/);
  assert.match(route, /\{\s*status:\s*200\s*\}/);
  assert.doesNotMatch(route, /\{\s*status:\s*readiness\.ready\s*\?\s*200\s*:\s*503\s*\}/);
});

test('best-effort restart recovery returns handled degradation instead of browser 502 errors', () => {
  for (const path of ['src/app/api/builds/resume/route.ts', 'src/app/api/intakes/resume/route.ts']) {
    const route = readFileSync(path, 'utf8');
    assert.match(route, /ok:\s*false/);
    assert.match(route, /degraded:\s*true/);
    assert.doesNotMatch(route, /status:\s*502/);
  }
});
