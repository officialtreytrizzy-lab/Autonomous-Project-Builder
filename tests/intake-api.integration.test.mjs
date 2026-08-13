import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createProjectResponse } from '../src/app/api/projects/route.ts';
import { uploadSourceResponse } from '../src/app/api/intakes/[intakeId]/sources/route.ts';
import { approveIntakeResponse } from '../src/app/api/intakes/[intakeId]/approve/route.ts';
import { replaceOrDeleteSourceResponse } from '../src/app/api/intakes/[intakeId]/sources/[sourceId]/route.ts';
import { IntakeStore } from '../src/lib/intake/store.ts';

const pdf = new Blob([Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')], { type: 'application/pdf' });

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
  const approvalResponse = await approveIntakeResponse(new Request('http://local/approve', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ briefVersionId: brief.id, buildConfiguration: { deployment: 'local' } }),
  }), project.intake_id, f.store);
  const approved = await approvalResponse.json();
  assert.equal(approvalResponse.status, 200);
  assert.match(approved.approval_hash, /^[a-f0-9]{64}$/);
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
