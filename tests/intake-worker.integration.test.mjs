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
  let synthesisCount = 0;
  const synthesize = async () => {
    synthesisCount += 1;
    return { brief: {
      outcome: 'Build it', users: ['Owner'], flows: ['Flow'], requirements: ['Requirement'], designDirection: [],
      dataAndIntegrations: [], exclusions: [], acceptanceTests: ['Pass'], assumptions: [],
    },
    contradictions: [],
    uncertainties: [],
  }; };

  await assert.rejects(() => runIntakeWorker({ store, intakeId: intake.id, processSource, synthesize }), /controlled interruption/);
  interruptAfterPage = 0;
  const completed = await runIntakeWorker({ store, intakeId: intake.id, processSource, synthesize });
  assert.deepEqual(processedPages, [1, 2, 3]);
  assert.equal(completed.visualCoverage.complete, true);
  assert.equal(store.currentBrief(intake.id)?.content.outcome, 'Build it');
  assert.equal(store.getIntake(intake.id)?.status, 'awaiting-approval');
  assert.equal(store.currentSources(intake.id)[0].processingStatus, 'complete');
  assert.equal(store.currentSources(intake.id)[0].inspectedPageCount, 3);
  const replayed = await runIntakeWorker({ store, intakeId: intake.id, processSource, synthesize });
  assert.equal(replayed.id, completed.id);
  assert.equal(synthesisCount, 1);
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

test('implementation plan evidence is marked authoritative before brief synthesis', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'intake-plan-role-'));
  const store = new IntakeStore(join(root, 'state.db'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const project = store.createProject({ name: 'Imported Plan', objective: 'Build from the plan', workspace: join(root, 'project'), inputMode: 'implementation-plan', implementationPlanFilename: 'plan.pdf' });
  const intake = store.createIntake(project.id);
  const plan = store.addSourceRevision(intake.id, { contentHash: 'plan-hash', mimeType: 'application/pdf', originalFilename: 'plan.pdf', normalizedFilename: 'plan.pdf', size: 4, localPath: join(root, 'plan.pdf'), role: 'implementation-plan' });
  const reference = store.addSourceRevision(intake.id, { contentHash: 'ref-hash', mimeType: 'image/png', originalFilename: 'screen.png', normalizedFilename: 'screen.png', size: 4, localPath: join(root, 'screen.png'), role: 'reference' });
  let synthesisEvidence = [];
  await runIntakeWorker({
    store,
    intakeId: intake.id,
    async processSource(source, context) {
      await context.checkpointPage(1, [{
        intakeId: intake.id, sourceId: source.sourceId, revisionId: source.revisionId, page: 1,
        kind: 'page-overview', content: source.sourceId === plan.sourceId ? 'Authoritative plan requirement' : 'Supporting screenshot detail',
        relationships: [], confidence: 1, processingMethod: 'test',
      }]);
      return { totalPages: 1, inspectedPages: 1 };
    },
    async synthesize(evidence) {
      synthesisEvidence = evidence;
      return { brief: { outcome: 'Build from plan', users: [], flows: [], requirements: ['Follow plan'], designDirection: [], dataAndIntegrations: [], exclusions: [], acceptanceTests: [], assumptions: [] }, contradictions: [], uncertainties: [] };
    },
  });
  const planEvidence = synthesisEvidence.find((item) => item.sourceId === plan.sourceId);
  const referenceEvidence = synthesisEvidence.find((item) => item.sourceId === reference.sourceId);
  assert.ok(planEvidence.relationships.includes('source-role:implementation-plan'));
  assert.equal(referenceEvidence.relationships.includes('source-role:implementation-plan'), false);
});

test('manual objective becomes authoritative evidence when no files are supplied', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'intake-manual-objective-'));
  const store = new IntakeStore(join(root, 'state.db'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const project = store.createProject({
    name: 'Fresh Website',
    objective: 'Build a responsive restaurant website with location-aware ordering and catering.',
    workspace: join(root, 'project'),
    inputMode: 'manual',
  });
  const intake = store.createIntake(project.id);
  let synthesisEvidence = [];

  const brief = await runIntakeWorker({
    store,
    intakeId: intake.id,
    async synthesize(evidence) {
      synthesisEvidence = evidence;
      return {
        brief: {
          outcome: 'Build the website',
          users: ['Customer'],
          flows: ['Choose location before ordering'],
          requirements: ['Responsive website'],
          designDirection: [],
          dataAndIntegrations: [],
          exclusions: [],
          acceptanceTests: ['Location choice is required'],
          assumptions: [],
        },
        contradictions: [],
        uncertainties: [],
      };
    },
  });

  assert.equal(synthesisEvidence.length, 1);
  assert.equal(synthesisEvidence[0].kind, 'user-text');
  assert.equal(synthesisEvidence[0].content, project.objective);
  assert.ok(synthesisEvidence[0].relationships.includes('authoritative:user-supplied'));
  assert.equal(synthesisEvidence[0].processingMethod, 'manual-project-objective');
  assert.equal(brief.visualCoverage.complete, true);
  assert.equal(store.getIntake(intake.id)?.status, 'awaiting-approval');
});

test('manual objective completes without model synthesis when no files are supplied', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'intake-manual-direct-'));
  const store = new IntakeStore(join(root, 'state.db'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const objective = 'Build a responsive restaurant website.\n\nREQUIRED TESTS\n1. Location-aware ordering works.\n2. Catering form submits.';
  const project = store.createProject({ name: 'Manual Direct', objective, workspace: join(root, 'project'), inputMode: 'manual' });
  const intake = store.createIntake(project.id);

  const brief = await runIntakeWorker({ store, intakeId: intake.id });

  assert.equal(brief.content.outcome, 'Build a responsive restaurant website.');
  assert.equal(brief.content.requirements[0], objective);
  assert.match(brief.content.acceptanceTests[0], /every explicit required test/i);
  assert.equal(brief.requiredInputs.length, 0);
  assert.equal(store.getIntake(intake.id)?.status, 'awaiting-approval');
  assert.equal(store.getProject(project.id)?.state, 'awaiting-approval');
});
