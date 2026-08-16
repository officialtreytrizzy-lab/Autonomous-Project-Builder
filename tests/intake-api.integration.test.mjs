import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { createProjectResponse } from '../src/app/api/projects/route.ts';
import { uploadSourceResponse } from '../src/app/api/intakes/[intakeId]/sources/route.ts';
import { approveIntakeResponse } from '../src/app/api/intakes/[intakeId]/approve/route.ts';
import { replaceOrDeleteSourceResponse } from '../src/app/api/intakes/[intakeId]/sources/[sourceId]/route.ts';
import { IntakeStore } from '../src/lib/intake/store.ts';

const pdf = new Blob([Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')], { type: 'application/pdf' });
function approveTestDesign(store, intakeId) {
  const intake = store.getIntake(intakeId);
  const model = 'test-design-model';
  store.ensureDesignSession(intakeId, model);
  store.appendDesignMessage(intakeId, { role: 'assistant', content: 'Approved test design direction.', model });
  return store.saveDesignContract({
    id: `design-${intakeId}`, intakeId, projectId: intake.projectId,
    version: store.nextDesignVersion(intakeId), status: 'approved', provider: 'openrouter', model,
    approvedAt: new Date().toISOString(), summary: 'Premium local application design.', principles: ['Clear hierarchy'],
    designSystem: { visualLanguage: 'Restrained premium interface', typography: ['Readable sans serif'], colorAndMaterial: ['High contrast surfaces'], spacingAndShape: ['Consistent spacing'], elevationAndDepth: ['Subtle depth'], motion: ['Reduced-motion safe transitions'] },
    screens: [], interactions: ['Clear primary actions'], responsiveRules: ['Works on mobile and desktop'], accessibility: ['Keyboard reachable controls'], assets: [], implementationRules: ['Do not substitute the approved visual system'], visualAcceptance: ['Matches the approved design contract'],
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'intake-api-'));
  const store = new IntakeStore(join(root, 'state.db'));
  return { root, store, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('API performs compose, upload, and approve without leaking private source paths', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const createdResponse = await createProjectResponse(new Request('http://local/api/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Flow', objective: 'Build ordering software' }),
  }), { store: f.store, projectsRoot: join(f.root, 'projects') });
  assert.equal(createdResponse.status, 201);
  const project = await createdResponse.json();

  const form = new FormData();
  form.set('file', pdf, 'Restaurant Flow.pdf');
  const uploadResponse = await uploadSourceResponse(new Request('http://local/sources', { method: 'POST', body: form }), project.intake_id, f.store);
  const upload = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201);
  assert.equal(JSON.stringify(upload).includes(project.workspace), false);
  assert.equal(JSON.stringify(upload).includes('localPath'), false);

  const brief = f.store.createBriefVersion(project.intake_id, {
    outcome: 'Create restaurant ordering software', users: ['Owner'], flows: ['Order'], requirements: ['Works locally'],
    designDirection: [], dataAndIntegrations: [], exclusions: [], acceptanceTests: ['Order succeeds'], assumptions: [],
  }, { inspectedPages: 1, totalPages: 1, complete: true });
  f.store.updateIntake(project.intake_id, { status: 'awaiting-approval' });
  approveTestDesign(f.store, project.intake_id);
  const approvalResponse = await approveIntakeResponse(new Request('http://local/approve', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ briefVersionId: brief.id, buildConfiguration: { deployment: 'local' } }),
  }), project.intake_id, f.store);
  const approved = await approvalResponse.json();
  assert.equal(approvalResponse.status, 200);
  assert.match(approved.approval_hash, /^[a-f0-9]{64}$/);
});

test('compose can attach an existing repository root without leaking its private path', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const repositoryRoot = join(f.root, 'existing-app');
  mkdirSync(join(repositoryRoot, '.git', 'info'), { recursive: true });
  writeFileSync(join(repositoryRoot, 'package.json'), '{"name":"existing-app"}');
  const response = await createProjectResponse(new Request('http://local/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Existing App', objective: 'Change the current app in place', repositoryRoot }),
  }), { store: f.store, projectsRoot: join(f.root, 'projects') });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.workspace_mode, 'existing');
  assert.equal(JSON.stringify(payload).includes(repositoryRoot), false);
  const stored = f.store.getProject(payload.project_id);
  assert.equal(stored.workspace, realpathSync(repositoryRoot));
  assert.equal(stored.workspaceMode, 'existing');
  assert.equal(existsSync(join(repositoryRoot, '.builder', 'intake-data', 'originals')), true);
  assert.match(readFileSync(join(repositoryRoot, '.git', 'info', 'exclude'), 'utf8'), /^\.builder\/$/m);
  assert.equal(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'), '{"name":"existing-app"}');
});

test('replacing source bytes creates a future revision and invalidates the old approval', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const project = f.store.createProject({ name: 'Revision', objective: 'Trace changes', workspace: join(f.root, 'project') });
  const intake = f.store.createIntake(project.id);
  const firstForm = new FormData();
  firstForm.set('file', pdf, 'requirements.pdf');
  const firstResponse = await uploadSourceResponse(new Request('http://local/sources', { method: 'POST', body: firstForm }), intake.id, f.store);
  const first = (await firstResponse.json()).source;
  const brief = f.store.createBriefVersion(intake.id, {
    outcome: 'Build', users: [], flows: [], requirements: [], designDirection: [], dataAndIntegrations: [], exclusions: [], acceptanceTests: [], assumptions: [],
  }, { inspectedPages: 1, totalPages: 1, complete: true });
  f.store.updateIntake(intake.id, { status: 'awaiting-approval' });
  approveTestDesign(f.store, intake.id);
  const approvalResponse = await approveIntakeResponse(new Request('http://local/approve', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ briefVersionId: brief.id }),
  }), intake.id, f.store);
  assert.equal(approvalResponse.status, 200);

  const replacement = new Blob([Buffer.from('%PDF-1.7\n2 0 obj\n<</Type /Catalog>>\nendobj\n%%EOF')], { type: 'application/pdf' });
  const replacementForm = new FormData();
  replacementForm.set('file', replacement, 'requirements-v2.pdf');
  const response = await replaceOrDeleteSourceResponse(new Request('http://local/source', { method: 'PUT', body: replacementForm }), intake.id, first.sourceId, f.store);
  const payload = await response.json();
  assert.equal(payload.source.revision, 2);
  assert.equal(f.store.getIntake(intake.id).status, 'queued');
  assert.equal(f.store.getProject(project.id).state, 'understanding');
});



test('implementation plan can create a managed project without typed name or description', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const projectsRoot = join(f.root, 'managed-root');
  const createdResponse = await createProjectResponse(new Request('http://local/api/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '', objective: '', inputMode: 'implementation-plan', implementationPlanFilename: 'Restaurant Operations Implementation Plan.pdf' }),
  }), { store: f.store, projectsRoot });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const stored = f.store.getProject(created.project_id);
  assert.ok(stored);
  assert.equal(stored.inputMode, 'implementation-plan');
  assert.equal(stored.implementationPlanFilename, 'Restaurant Operations Implementation Plan.pdf');
  assert.match(stored.name, /Restaurant Operations Implementation Plan/i);
  assert.match(stored.objective, /implementation plan/i);
  assert.equal(dirname(stored.workspace), realpathSync(projectsRoot));

  const form = new FormData();
  form.set('file', pdf, 'Restaurant Operations Implementation Plan.pdf');
  form.set('role', 'implementation-plan');
  const uploadResponse = await uploadSourceResponse(new Request('http://local/sources', { method: 'POST', body: form }), created.intake_id, f.store);
  const uploaded = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201);
  assert.equal(uploaded.source.role, 'implementation-plan');
});

test('manual project creation still requires a name and description', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const response = await createProjectResponse(new Request('http://local/api/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '', objective: '', inputMode: 'manual' }),
  }), { store: f.store, projectsRoot: join(f.root, 'projects') });
  assert.equal(response.status, 400);
});
