import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { IntakeStore } from '../src/lib/intake/store.ts';
import { runIntakeWorker } from '../src/lib/intake/worker.ts';

test('worker checkpoints each page and resumes without reprocessing completed pages', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'intake-worker-'));
  const store = new IntakeStore(join(root, 'state.db'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const project = store.createProject({ name: 'Resume Brief', objective: 'Understand all pages', workspace: join(root, 'project') });
  const intake = store.createIntake(project.id);
  store.addSourceRevision(intake.id, {
    contentHash: 'hash', mimeType: 'application/pdf', originalFilename: 'flow.pdf', normalizedFilename: 'flow.pdf',
    size: 4, localPath: join(root, 'flow.pdf'),
  });
  const processedPages = [];
  let interruptAfterPage = 1;
  const processSource = async (source, context) => {
    for (const page of [1, 2, 3]) {
      if (context.completedPages.has(page)) continue;
      processedPages.push(page);
      await context.checkpointPage(page, [{
        intakeId: intake.id,
        sourceId: source.sourceId,
        revisionId: source.revisionId,
        page,
        kind: 'page-overview',
        content: `Page ${page}`,
        relationships: [],
        confidence: 1,
        processingMethod: 'fake-local-vision',
      }]);
      if (page === interruptAfterPage) throw new Error('controlled interruption');
    }
    return { totalPages: 3, inspectedPages: 3 };
  };
  const synthesize = async () => ({
    brief: {
      outcome: 'Build it', users: ['Owner'], flows: ['Flow'], requirements: ['Requirement'], designDirection: [],
      dataAndIntegrations: [], exclusions: [], acceptanceTests: ['Pass'], assumptions: [],
    },
    contradictions: [],
    uncertainties: [],
  });

  await assert.rejects(() => runIntakeWorker({ store, intakeId: intake.id, processSource, synthesize }), /controlled interruption/);
  interruptAfterPage = 0;
  const completed = await runIntakeWorker({ store, intakeId: intake.id, processSource, synthesize });
  assert.deepEqual(processedPages, [1, 2, 3]);
  assert.equal(completed.visualCoverage.complete, true);
  assert.equal(store.currentBrief(intake.id)?.content.outcome, 'Build it');
  assert.equal(store.getIntake(intake.id)?.status, 'awaiting-approval');
});

test('worker leaves unresolved contradictions as required pre-build decisions', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'intake-conflict-'));
  const store = new IntakeStore(join(root, 'state.db'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const project = store.createProject({ name: 'Conflict', objective: 'Resolve evidence', workspace: join(root, 'project') });
  const intake = store.createIntake(project.id);
  store.addSourceRevision(intake.id, {
    contentHash: 'hash', mimeType: 'text/plain', originalFilename: 'brief.txt', normalizedFilename: 'brief.txt', size: 4, localPath: join(root, 'brief.txt'),
  });
  await runIntakeWorker({
    store,
    intakeId: intake.id,
    async processSource() { return { totalPages: 0, inspectedPages: 0 }; },
    async synthesize() {
      return {
        brief: { outcome: 'Build it', users: [], flows: [], requirements: [], designDirection: [], dataAndIntegrations: [], exclusions: [], acceptanceTests: [], assumptions: [] },
        contradictions: ['Text requests blue while page 2 mockup specifies red.'],
        uncertainties: [],
      };
    },
  });
  const brief = store.currentBrief(intake.id);
  assert.ok(brief);
  const decisions = store.decisionsForBrief(brief.id);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].required, true);
  assert.match(decisions[0].question, /blue.*red/i);
  assert.equal(store.getIntake(intake.id)?.status, 'awaiting-resolution');
});
