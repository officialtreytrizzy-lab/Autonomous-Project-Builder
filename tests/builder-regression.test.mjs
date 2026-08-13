import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeBuild,
  analyzeIngredients,
  applyCapabilityHealth,
  buildExecutionPlan,
  routeCapability,
  shouldInterrupt,
} from '../src/lib/builder.ts';

test('a repository-free local request remains runnable on Computer 2', () => {
  const request = { objective: 'Build a private app', deployment: 'local', backend: 'none', workflow: 'none' };
  const analysis = analyzeBuild(request);
  const repository = analysis.ingredients.find((item) => item.id === 'repository');
  const deployment = analysis.ingredients.find((item) => item.id === 'deployment');

  assert.equal(analysis.canContinue, true);
  assert.deepEqual(
    { level: repository?.level, target: repository?.target, blocking: repository?.blocking },
    { level: 'green', target: 'computer-2', blocking: false },
  );
  assert.deepEqual(
    { level: deployment?.level, target: deployment?.target },
    { level: 'green', target: 'computer-2' },
  );
  assert.equal(deployment?.detail, 'Application will be built, verified and served privately on Computer 2.');
  assert.equal(analysis.ingredients.find((item) => item.id === 'backend')?.target, 'computer-2');
});

test('local workspaces and remote repositories take different inspection routes', () => {
  const localPlan = buildExecutionPlan({ deployment: 'local', backend: 'none', workflow: 'none' });
  const remotePlan = buildExecutionPlan({ repository: 'owner/project', deployment: 'local', backend: 'none', workflow: 'none' });

  assert.equal(localPlan.find((step) => step.id === 'inspect')?.target, 'computer-2');
  assert.equal(remotePlan.find((step) => step.id === 'inspect')?.target, 'docker-mcp');
  assert.equal(localPlan.find((step) => step.id === 'runtime')?.target, 'computer-2');
});

test('yellow ingredients continue while only blocking red ingredients interrupt', () => {
  const yellow = analyzeIngredients({ backend: 'supabase', deployment: 'local' });
  assert.equal(yellow.find((item) => item.id === 'backend')?.level, 'yellow');
  assert.equal(shouldInterrupt(yellow), false);
  assert.equal(shouldInterrupt([
    { id: 'credential', label: 'Credential', level: 'red', required: true, available: false, target: 'user', detail: 'User-only secret', blocking: true },
  ]), true);
});

test('capability routing keeps host work local and optional services scoped', () => {
  assert.equal(routeCapability('local runtime and filesystem'), 'computer-2');
  assert.equal(routeCapability('authenticated Chrome action'), 'computer-2');
  assert.equal(routeCapability('GitHub repository'), 'docker-mcp');
  assert.equal(routeCapability('scheduled long-running workflow'), 'windmill');
});

test('live capability state blocks only unavailable core dependencies', () => {
  const local = applyCapabilityHealth(analyzeBuild({ objective: 'local', deployment: 'local' }), {
    computer2: false, dockerGateway: false, windmill: false, authenticatedChrome: false,
  });
  assert.equal(local.canContinue, false);
  assert.equal(local.ingredients.find((item) => item.id === 'deployment')?.level, 'red');

  const optional = applyCapabilityHealth(analyzeBuild({ objective: 'service', repository: 'owner/repo', backend: 'supabase', deployment: 'vercel', workflow: 'windmill', needsAuthenticatedBrowser: true }), {
    computer2: true, dockerGateway: false, windmill: false, authenticatedChrome: false,
  });
  assert.equal(optional.canContinue, true);
  assert.equal(optional.ingredients.find((item) => item.id === 'backend')?.level, 'yellow');
  assert.equal(optional.ingredients.find((item) => item.id === 'browser')?.level, 'yellow');
  assert.equal(optional.ingredients.find((item) => item.id === 'workflow')?.level, 'yellow');
});
