import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BuildService } from '../src/lib/build-service.ts';
import { BuildStore } from '../src/lib/build-store.ts';
import { computeApprovalHash } from '../src/lib/intake/contract.ts';
import { IntakeStore } from '../src/lib/intake/store.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'approved-build-'));
  const databasePath = join(root, 'state.db');
  const intakeStore = new IntakeStore(databasePath);
  const buildStore = new BuildStore(databasePath);
  const project = intakeStore.createProject({ name: 'Approved Product', objective: 'Initial description', workspace: join(root, 'intake-project') });
  const intake = intakeStore.createIntake(project.id);
  const source = intakeStore.addSourceRevision(intake.id, {
    contentHash: 'source-hash-one', mimeType: 'application/pdf', originalFilename: 'requirements.pdf', normalizedFilename: 'requirements.pdf',
    size: 100, localPath: join(root, 'private', 'requirements.pdf'),
  });
  const brief = intakeStore.createBriefVersion(intake.id, {
    outcome: 'Create a premium private restaurant ordering app.',
    users: ['Restaurant owner'],
    flows: ['Create menu', 'Accept order'],
    requirements: ['Local-first', 'No demo data'],
    designDirection: ['Precision Liquid Glass'],
    dataAndIntegrations: [],
    exclusions: ['No public deployment'],
    acceptanceTests: ['Owner can create a real menu item'],
    assumptions: [],
  }, { inspectedPages: 2, totalPages: 2, complete: true });
  const decision = intakeStore.addDecision(brief.id, { question: 'Use local deployment?', required: true });
  intakeStore.resolveDecision(decision.decisionId, 'Yes');
  const buildConfiguration = {
    repository: '', backend: 'none', deployment: 'local', workflow: 'none', needsAuthenticatedBrowser: false, needsWindowsHost: true,
  };
  const currentInput = () => ({
    brief: intakeStore.currentBrief(intake.id),
    sources: intakeStore.currentSources(intake.id),
    decisions: intakeStore.decisionsForBrief(brief.id),
    buildConfiguration,
  });
  const hash = computeApprovalHash(currentInput());
  intakeStore.approve({ projectId: project.id, intakeId: intake.id, briefVersionId: brief.id, hash, buildConfiguration });
  const calls = [];
  const caller = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'plan_create') return { plan_id: 'plan-approved' };
    if (tool === 'job_submit') return { job_id: 'job-approved' };
    throw new Error(`Unexpected ${tool}`);
  };
  const service = new BuildService({
    store: buildStore, intakeStore, callComputer2: caller, projectsRoot: join(root, 'projects'), allocatePort: async () => 3277,
  });
  return {
    root, buildStore, intakeStore, project, intake, source, brief, hash, calls, service,
    close() { buildStore.close(); intakeStore.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test('build start rejects missing and stale approval contracts before Computer 2 calls', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  await assert.rejects(() => f.service.startApproved({ intakeId: f.intake.id, approvalHash: '' }), /approval required/i);
  await assert.rejects(() => f.service.startApproved({ intakeId: f.intake.id, approvalHash: 'stale' }), /approval no longer matches/i);
  assert.equal(f.calls.length, 0);
});

test('material source changes invalidate approval while harmless renaming does not', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  f.intakeStore.addSourceRevision(f.intake.id, {
    sourceId: f.source.sourceId,
    contentHash: 'source-hash-two', mimeType: 'application/pdf', originalFilename: 'renamed.pdf', normalizedFilename: 'renamed.pdf',
    size: 101, localPath: join(f.root, 'private', 'renamed.pdf'),
  });
  await assert.rejects(() => f.service.startApproved({ intakeId: f.intake.id, approvalHash: f.hash }), /approval no longer matches/i);
  assert.equal(f.calls.length, 0);
});

test('approved brief is copied into immutable worker request without private source paths', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const build = await f.service.startApproved({ intakeId: f.intake.id, approvalHash: f.hash });
  const request = readFileSync(join(build.workspace, '.builder', 'approved-brief.md'), 'utf8');
  assert.match(request, /Acceptance tests/i);
  assert.match(request, /Owner can create a real menu item/);
  assert.match(request, /requirements\.pdf/);
  assert.equal(request.includes(f.source.localPath), false);
  assert.equal(build.approvalHash, f.hash);
  assert.equal(build.intakeId, f.intake.id);
  assert.equal(build.briefVersionId, f.brief.id);
  assert.equal(build.projectId, f.project.id);
});

test('approved build modifies a selected existing app in its current root', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  mkdirSync(f.project.workspace, { recursive: true });
  writeFileSync(join(f.project.workspace, 'existing-feature.txt'), 'preserve-me');
  f.intakeStore.updateProject(f.project.id, { workspaceMode: 'existing' });
  const build = await f.service.startApproved({ intakeId: f.intake.id, approvalHash: f.hash });
  assert.equal(build.workspace, f.project.workspace);
  assert.equal(readFileSync(join(f.project.workspace, 'existing-feature.txt'), 'utf8'), 'preserve-me');
  assert.match(readFileSync(join(build.workspace, '.builder', 'request.md'), 'utf8'), /modify it in place/i);
  const submit = f.calls.find((call) => call.tool === 'job_submit');
  assert.equal(submit.args.arguments.cwd, f.project.workspace);
});

test('incomplete visual coverage and unresolved required decisions cannot be approved for execution', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const incomplete = f.intakeStore.createBriefVersion(f.intake.id, f.brief.content, { inspectedPages: 1, totalPages: 2, complete: false });
  const config = f.intakeStore.currentApproval(f.intake.id).buildConfiguration;
  const hash = computeApprovalHash({ brief: incomplete, sources: f.intakeStore.currentSources(f.intake.id), decisions: [], buildConfiguration: config });
  f.intakeStore.approve({ projectId: f.project.id, intakeId: f.intake.id, briefVersionId: incomplete.id, hash, buildConfiguration: config });
  await assert.rejects(() => f.service.startApproved({ intakeId: f.intake.id, approvalHash: hash }), /visual inspection.*incomplete/i);
  assert.equal(f.calls.length, 0);
});
