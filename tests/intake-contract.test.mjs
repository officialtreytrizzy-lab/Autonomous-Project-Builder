import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeApprovalHash,
  isMaterialContractChange,
} from '../src/lib/intake/contract.ts';

function contractFixture() {
  return {
    brief: {
      id: 'brief-1',
      intakeId: 'intake-1',
      version: 3,
      content: {
        outcome: 'Build a private restaurant ordering application.',
        users: ['Guest', 'Manager'],
        flows: ['Guest confirms the order before payment.'],
        requirements: ['The menu works on desktop and mobile.'],
        designDirection: ['Use the supplied wireframe.'],
        dataAndIntegrations: ['No remote database.'],
        exclusions: ['No cloud deployment.'],
        acceptanceTests: ['The production runtime responds on localhost.'],
        assumptions: [],
      },
      visualCoverage: { inspectedPages: 2, totalPages: 2, complete: true },
    },
    sources: [{
      sourceId: 'source-1',
      revisionId: 'revision-1',
      revision: 1,
      contentHash: 'sha256-document-one',
      mimeType: 'application/pdf',
      originalFilename: 'Restaurant Flow.pdf',
      normalizedFilename: 'restaurant-flow.pdf',
      size: 2048,
      ingestedAt: '2026-08-13T00:00:00.000Z',
      availability: 'available',
      processingStatus: 'complete',
    }],
    decisions: [{
      decisionId: 'decision-1',
      question: 'When does payment occur?',
      resolution: 'After confirmation.',
      required: true,
      resolvedAt: '2026-08-13T00:02:00.000Z',
    }],
    buildConfiguration: {
      repository: '',
      backend: 'none',
      deployment: 'local',
      workflow: 'none',
      needsAuthenticatedBrowser: false,
      needsWindowsHost: true,
    },
  };
}

test('approval hash ignores harmless source display metadata', () => {
  const original = contractFixture();
  const renamed = structuredClone(original);
  renamed.sources[0].originalFilename = 'Renamed Flow.pdf';
  renamed.sources[0].normalizedFilename = 'renamed-flow.pdf';
  renamed.sources[0].ingestedAt = '2030-01-01T00:00:00.000Z';
  renamed.sources[0].availability = 'deleted';

  assert.equal(computeApprovalHash(original), computeApprovalHash(renamed));
  assert.equal(isMaterialContractChange(original, renamed), false);
});

test('approval hash is deterministic when source and decision order changes', () => {
  const original = contractFixture();
  original.sources.push({ ...original.sources[0], sourceId: 'source-2', revisionId: 'revision-2', contentHash: 'sha256-document-two' });
  original.decisions.push({ ...original.decisions[0], decisionId: 'decision-2', resolution: 'Managers can issue refunds.' });
  const reordered = structuredClone(original);
  reordered.sources.reverse();
  reordered.decisions.reverse();

  assert.equal(computeApprovalHash(original), computeApprovalHash(reordered));
});

test('material source, decision, brief, and build configuration changes invalidate approval', () => {
  const mutations = [
    (value) => { value.sources[0].contentHash = 'changed'; },
    (value) => { value.decisions[0].resolution = 'Payment happens first.'; },
    (value) => { value.brief.content.requirements.push('Add inventory management.'); },
    (value) => { value.buildConfiguration.deployment = 'vercel'; },
  ];

  for (const mutate of mutations) {
    const original = contractFixture();
    const changed = structuredClone(original);
    mutate(changed);
    assert.notEqual(computeApprovalHash(original), computeApprovalHash(changed));
    assert.equal(isMaterialContractChange(original, changed), true);
  }
});

test('implementation plan role is material to the approved build contract', () => {
  const original = contractFixture();
  const changed = structuredClone(original);
  changed.sources[0].role = 'implementation-plan';
  assert.notEqual(computeApprovalHash(original), computeApprovalHash(changed));
  assert.equal(isMaterialContractChange(original, changed), true);
});
