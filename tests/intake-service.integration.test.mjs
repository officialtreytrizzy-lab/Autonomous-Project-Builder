import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { IntakeService } from '../src/lib/intake/service.ts';
import { IntakeStore } from '../src/lib/intake/store.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'intake-service-'));
  const databasePath = join(root, 'state.db');
  const store = new IntakeStore(databasePath);
  const project = store.createProject({ name: 'Durable Intake', objective: 'Understand documents', workspace: join(root, 'project') });
  const intake = store.createIntake(project.id);
  const calls = [];
  let status = 'running';
  const caller = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'plan_create') return { plan_id: 'plan-intake-1' };
    if (tool === 'job_submit') return { job_id: 'job-intake-1', status: 'queued' };
    if (tool === 'job_status') return { job_id: 'job-intake-1', status };
    if (tool === 'job_result') return { job_id: 'job-intake-1', status };
    if (tool === 'job_cancel') return { job_id: 'job-intake-1', status: 'cancelled' };
    if (tool === 'job_resume') return { resumed_count: 1 };
    throw new Error(`Unexpected tool: ${tool}`);
  };
  const service = new IntakeService({ store, callComputer2: caller, databasePath, workerPath: join(root, 'dist-worker', 'intake-worker.mjs') });
  return {
    root, store, project, intake, calls, service,
    setStatus(value) { status = value; },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test('intake service submits one persisted Computer 2 job and resumes it', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const intake = await f.service.analyze(f.intake.id);
  assert.equal(intake.planId, 'plan-intake-1');
  assert.equal(intake.jobId, 'job-intake-1');
  assert.equal(f.calls.some((call) => call.tool === 'plan_create'), true);
  assert.equal(f.calls.some((call) => call.tool === 'job_submit'), true);
  const submission = f.calls.find((call) => call.tool === 'job_submit');
  assert.equal(submission.args.arguments.cwd, f.project.workspace);
  assert.match(submission.args.arguments.actions[0].command, /intake-worker\.mjs/);
  assert.equal(submission.args.arguments.actions[0].command.includes('token'), false);

  await f.service.resumeInterrupted();
  assert.equal(f.calls.some((call) => call.tool === 'job_resume'), true);
  assert.equal(f.calls.some((call) => call.tool === 'job_status'), true);
});

test('intake refresh and cancellation follow the durable Computer 2 job', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const intake = await f.service.analyze(f.intake.id);
  const running = await f.service.refresh(intake.id);
  assert.equal(running.status, 'inspecting');
  const cancelled = await f.service.cancel(intake.id);
  assert.equal(cancelled.status, 'failed');
  assert.equal(f.calls.some((call) => call.tool === 'job_cancel'), true);
  assert.equal(f.store.getProject(f.project.id)?.state, 'cancelled');
});
