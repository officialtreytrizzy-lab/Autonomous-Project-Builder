import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DesignService } from '../src/lib/design/service.ts';
import { computeApprovalHash } from '../src/lib/intake/contract.ts';
import { IntakeStore } from '../src/lib/intake/store.ts';

const fakeImage = async () => ({
  mimeType: 'image/png',
  data: Buffer.from('fake-rendered-app-screen').toString('base64'),
  model: '@cf/black-forest-labs/flux-2-klein-4b',
  provider: 'cloudflare',
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'design-studio-'));
  const store = new IntakeStore(join(root, 'state.db'));
  const project = store.createProject({ name: 'Designed App', objective: 'Build a premium local app', workspace: join(root, 'project') });
  const intake = store.createIntake(project.id);
  const brief = store.createBriefVersion(intake.id, {
    outcome: 'Build a premium local app', users: ['Owner'], flows: ['Review dashboard'], requirements: ['Responsive'],
    designDirection: ['Quiet luxury with restrained glass'], dataAndIntegrations: [], exclusions: [], acceptanceTests: ['Dashboard is usable'], assumptions: [],
  }, { inspectedPages: 0, totalPages: 0, complete: true });
  store.updateIntake(intake.id, { status: 'awaiting-approval' });
  return { root, store, project, intake, brief, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('design studio persists collaboration and turns it into an approved immutable contract', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  let call = 0;
  const fakeAi = async () => {
    call += 1;
    if (call === 1) return 'Use a calm glass shell, strong editorial type hierarchy, and a compact owner dashboard.';
    return JSON.stringify({
      summary: 'Quiet luxury owner dashboard.', principles: ['Clear hierarchy', 'Restrained glass'],
      designSystem: { visualLanguage: 'Quiet luxury', typography: ['Editorial display plus readable sans'], colorAndMaterial: ['Dark glass surfaces'], spacingAndShape: ['12px rhythm'], elevationAndDepth: ['Subtle layered depth'], motion: ['Short purposeful transitions'] },
      screens: [{ name: 'Dashboard', purpose: 'Give the owner an immediate operational view', layout: ['Two-column desktop grid'], components: ['Metric cards'], states: ['Loading', 'Empty', 'Ready'], mobile: ['Single column'], desktop: ['Persistent side rail'] }],
      interactions: ['Primary actions remain visible'], responsiveRules: ['Collapse to one column below tablet width'], accessibility: ['Keyboard focus is visible'], assets: [],
      implementationRules: ['Match the approved spacing and materials exactly'], visualAcceptance: ['Dashboard composition matches the contract'],
    });
  };
  const service = new DesignService(f.store, fakeAi, fakeImage);
  const chat = await service.chat(f.intake.id, 'Make it feel expensive without being flashy.', { constructTemplate: true, elements: ['liquid-glass'] });
  assert.equal(chat.session.messages.length, 2);
  assert.equal(chat.session.messages[1].role, 'assistant');
  assert.equal(chat.session.mockups.length, 3);
  assert.equal(chat.session.mockups[0].model, '@cf/black-forest-labs/flux-2-klein-4b');
  const contract = await service.approve(f.intake.id);
  assert.equal(contract.status, 'approved');
  assert.equal(contract.version, 1);
  assert.equal(contract.mockups.length, 3);
  assert.equal(f.store.currentDesignSession(f.intake.id).status, 'approved');
  assert.equal(f.store.currentDesignContract(f.intake.id).summary, 'Quiet luxury owner dashboard.');
  const base = { brief: f.brief, sources: [], decisions: [], buildConfiguration: { repository: '', backend: 'none', deployment: 'local', workflow: 'none', needsAuthenticatedBrowser: false, needsWindowsHost: true } };
  assert.notEqual(computeApprovalHash(base), computeApprovalHash({ ...base, design: contract }));
});

test('semantic memory stores episodes and builder lessons require proven regression improvement', (t) => {
  const f = fixture();
  t.after(() => f.close());
  f.store.rememberSemanticSegment(f.project.id, { kind: 'repair', title: 'Runtime repair', content: 'Second HTTP probe caught an exited production process.', tags: ['runtime', 'http'], confidence: 1 });
  assert.equal(f.store.searchSemanticMemory(f.project.id, 'runtime http').length, 1);
  const lesson = f.store.proposeBuilderLesson(f.project.id, { trigger: 'runtime exited after launch', lesson: 'One boot probe is insufficient', proposedChange: 'Require two HTTP probes', evidence: ['build-1'] });
  assert.equal(lesson.status, 'candidate');
  const notYet = f.store.setBuilderLessonRegression(lesson.id, { beforePassed: true, afterPassed: true, improved: false, note: 'No measurable improvement' });
  assert.equal(notYet.status, 'candidate');
  const validated = f.store.setBuilderLessonRegression(lesson.id, { beforePassed: true, afterPassed: true, improved: true, note: 'Caught the regression reliably' });
  assert.equal(validated.status, 'validated');
});

test('visual QA scores the running implementation against the approved contract', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  let call = 0;
  const fakeAi = async (input) => {
    call += 1;
    if (call === 1) return 'Use the approved quiet luxury direction.';
    if (call === 2) return JSON.stringify({ summary: 'Quiet luxury owner dashboard.', principles: ['Clear hierarchy'], designSystem: { visualLanguage: 'Quiet luxury', typography: ['Readable sans'], colorAndMaterial: ['Dark glass'], spacingAndShape: ['12px rhythm'], elevationAndDepth: ['Subtle depth'], motion: ['Short transitions'] }, screens: [], interactions: [], responsiveRules: [], accessibility: [], assets: [], implementationRules: ['Match exactly'], visualAcceptance: ['Match approved composition'] });
    assert.equal(Array.isArray(input.messages[0].content), true);
    return JSON.stringify({ score: 94, summary: 'Close, but spacing and mobile hierarchy drift.', strengths: ['Material treatment is faithful'], mismatches: [{ area: 'Mobile header', severity: 'high', expected: 'Compact hierarchy', observed: 'Oversized header', repair: 'Reduce header height and type scale' }] });
  };
  const service = new DesignService(f.store, fakeAi, fakeImage);
  await service.chat(f.intake.id, 'Use quiet luxury.', { constructTemplate: true, elements: ['liquid-glass'] });
  await service.approve(f.intake.id);
  const qa = await service.reviewImplementation(f.intake.id, [{ label: 'desktop', dataUrl: 'data:image/png;base64,AA==' }, { label: 'mobile', dataUrl: 'data:image/png;base64,AA==' }], 98);
  assert.equal(qa.score, 94);
  assert.equal(qa.passed, false);
  assert.equal(qa.mismatches[0].severity, 'high');
  assert.match(f.store.semanticMemories(f.project.id)[0].title, /Visual QA 94/);
});
