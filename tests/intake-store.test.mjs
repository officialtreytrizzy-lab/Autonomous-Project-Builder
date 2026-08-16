import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IntakeStore } from '../src/lib/intake/store.ts';

function withStore(run) {
  const directory = mkdtempSync(join(tmpdir(), 'builder-intake-store-'));
  const databasePath = join(directory, 'state.db');
  const store = new IntakeStore(databasePath);
  try { return run({ store, databasePath }); }
  finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}

function sourceInput(overrides = {}) {
  return {
    contentHash: 'hash-1',
    mimeType: 'application/pdf',
    originalFilename: 'Flow.pdf',
    normalizedFilename: 'flow.pdf',
    size: 2048,
    localPath: 'C:\\private\\flow.pdf',
    ...overrides,
  };
}

test('store persists immutable source revisions and replacement lineage', () => withStore(({ store }) => {
  const project = store.createProject({ name: 'Restaurant Flow', objective: 'Build ordering software', workspace: 'C:\\projects\\restaurant' });
  const intake = store.createIntake(project.id);
  const first = store.addSourceRevision(intake.id, sourceInput());
  const second = store.addSourceRevision(intake.id, sourceInput({ sourceId: first.sourceId, contentHash: 'hash-2', size: 4096, localPath: 'C:\\private\\flow-r2.pdf' }));

  assert.equal(second.revision, 2);
  assert.equal(second.replacesRevisionId, first.revisionId);
  assert.equal(store.listSourceRevisions(intake.id).length, 2);
  assert.equal(store.currentSources(intake.id)[0].contentHash, 'hash-2');
}));

test('project events retain monotonic sequence and survive a new store instance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'builder-intake-events-'));
  const databasePath = join(directory, 'state.db');
  try {
    const firstStore = new IntakeStore(databasePath);
    const project = firstStore.createProject({ name: 'Flow', objective: 'Build it', workspace: 'C:\\projects\\flow' });
    const one = firstStore.appendEvent(project.id, { category: 'intake', stage: 'compose', severity: 'info', source: 'builder', humanMessage: 'Source stored' });
    const two = firstStore.appendEvent(project.id, { category: 'intake', stage: 'understanding', severity: 'success', source: 'worker', humanMessage: 'Source understood' });
    firstStore.close();

    const restored = new IntakeStore(databasePath);
    const replay = restored.eventsAfter(project.id, one.sequence);
    assert.equal(two.sequence, one.sequence + 1);
    assert.equal(replay.length, 1);
    assert.equal(replay[0].eventId, two.eventId);
    restored.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('brief, decisions, approval, and tombstoned evidence remain traceable', () => withStore(({ store }) => {
  const project = store.createProject({ name: 'Flow', objective: 'Build it', workspace: 'C:\\projects\\flow' });
  const intake = store.createIntake(project.id);
  const source = store.addSourceRevision(intake.id, sourceInput());
  store.recordEvidence({
    intakeId: intake.id,
    sourceId: source.sourceId,
    revisionId: source.revisionId,
    page: 1,
    kind: 'diagram',
    content: 'Confirmation happens before payment.',
    relationships: ['confirmation -> payment'],
    confidence: 0.96,
    processingMethod: 'local-vision',
  });
  const brief = store.createBriefVersion(intake.id, {
    outcome: 'Build the ordering application.', users: ['Guest'], flows: ['Confirm before payment.'],
    requirements: [], designDirection: [], dataAndIntegrations: [], exclusions: [], acceptanceTests: [], assumptions: [],
  }, { inspectedPages: 1, totalPages: 1, complete: true });
  const decision = store.addDecision(brief.id, { question: 'When is payment?', required: true });
  store.resolveDecision(decision.decisionId, 'After confirmation.');
  const approval = store.approve({ projectId: project.id, intakeId: intake.id, briefVersionId: brief.id, hash: 'a'.repeat(64), buildConfiguration: { repository: '', backend: 'none', deployment: 'local', workflow: 'none', needsAuthenticatedBrowser: false, needsWindowsHost: true } });
  store.tombstoneSource(source.sourceId);

  assert.equal(store.currentBrief(intake.id)?.id, brief.id);
  assert.equal(store.decisionsForBrief(brief.id)[0].resolution, 'After confirmation.');
  assert.equal(store.currentApproval(intake.id)?.hash, approval.hash);
  assert.equal(store.currentSources(intake.id)[0].availability, 'deleted');
  assert.equal(store.evidenceForBriefSource(intake.id, source.sourceId).length, 1);
}));
