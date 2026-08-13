import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBuildForRestore } from '../src/lib/build-selection.ts';

test('restoration falls back to latest history when an interruption has no job id', () => {
  const builds = [
    { id: 'legacy', status: 'interrupted', jobId: '' },
    { id: 'complete', status: 'complete', jobId: 'job-done' },
  ];
  assert.equal(selectBuildForRestore(builds)?.id, 'complete');
});

test('restoration prioritizes active execution over stale interruptions', () => {
  const builds = [
    { id: 'legacy', status: 'interrupted', jobId: '' },
    { id: 'active', status: 'running', jobId: 'job-live' },
    { id: 'recoverable', status: 'interrupted', jobId: 'job-retry' },
  ];
  assert.equal(selectBuildForRestore(builds)?.id, 'active');
});

test('restoration prioritizes a recoverable interruption over terminal history', () => {
  const builds = [
    { id: 'latest-complete', status: 'complete', jobId: 'job-done' },
    { id: 'recoverable', status: 'interrupted', jobId: 'job-retry' },
  ];
  assert.equal(selectBuildForRestore(builds)?.id, 'recoverable');
});
