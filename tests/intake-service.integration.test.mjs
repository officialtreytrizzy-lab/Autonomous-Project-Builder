import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  let submissions = 0;
  const caller = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'plan_create') return { plan_id: 'plan-intake-1' };
    if (tool === 'job_submit') { submissions += 1; return { job_id: `job-intake-${submissions}`, status: 'queued' }; }
    if (tool === 'job_status') return { job_id: 'job-intake-1', status };
    if (tool === 'job_result') return { job_id: 'job-intake-1', status };
    if (tool === 'job_cancel') return { job_id: 'job-intake-1', status: 'cancelled' };
    if (tool === 'job_resume') return { resumed_count: 1 };
    if (tool === 'computer_batch') return { ok: true };
    throw new Error(`Unexpected tool: ${tool}`);
  };
  const pdfRendererPath = join(root, 'tools', 'pdftoppm.exe');
  const service = new IntakeService({
    store,
    callComputer2: caller,
    databasePath,
    workerPath: join(root, 'dist-worker', 'intake-worker.mjs'),
    discoverCapabilities: async () => ({
      word: { available: true, detail: 'Word COM available' },
      pdfRenderer: { available: true, path: pdfRendererPath, detail: 'PDF renderer available' },
      ollama: { installed: true, running: true, endpoint: 'http://127.0.0.1:11434' },
      vision: { available: true, installedCandidates: ['gemma3:4b'], model: 'gemma3:4b', detail: 'Vision ready' },
    }),
  });
  return {
    root, store, project, intake, calls, service, pdfRendererPath,
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
  assert.match(submission.args.arguments.actions[0].command, /intake-launch\.ps1/);
  assert.doesNotMatch(submission.args.arguments.actions[0].command, /intake-worker\.mjs|--database|--intake/);
  const workerScript = readFileSync(join(f.project.workspace, '.builder', 'intake', f.intake.id, 'intake-worker.ps1'), 'utf8');
  const launcherScript = readFileSync(join(f.project.workspace, '.builder', 'intake', f.intake.id, 'intake-launch.ps1'), 'utf8');
  assert.match(workerScript, /intake-worker\.mjs/);
  assert.match(workerScript, new RegExp(`--pdf-renderer.+${f.pdfRendererPath.replaceAll('\\', '\\\\')}`));
  assert.match(workerScript, /\$ErrorActionPreference = 'Continue'[\s\S]+\$exitCode = \$LASTEXITCODE[\s\S]+\$ErrorActionPreference = 'Stop'/);
  assert.match(launcherScript, /Register-ScheduledTask/);
  assert.match(launcherScript, /Start-ScheduledTask/);
  assert.equal(submission.args.arguments.actions[0].command.includes('token'), false);
  assert.equal(submission.args.arguments.actions[0].timeout_ms <= 600_000, true);

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

test('blocked intake reuses its plan and submits a recovery job from checkpoints', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const first = await f.service.analyze(f.intake.id);
  f.store.updateIntake(first.id, { status: 'blocked' });

  const recovered = await f.service.analyze(first.id);

  assert.equal(recovered.planId, 'plan-intake-1');
  assert.equal(recovered.jobId, 'job-intake-2');
  assert.equal(f.calls.filter((call) => call.tool === 'plan_create').length, 1);
  assert.equal(f.calls.filter((call) => call.tool === 'job_submit').length, 2);
});

test('restart recovery resubmits a checkpointed intake whose prior job ended', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const first = await f.service.analyze(f.intake.id);
  f.store.updateIntake(first.id, { status: 'blocked' });
  f.setStatus('succeeded');

  await f.service.resumeInterrupted();

  assert.equal(f.calls.filter((call) => call.tool === 'job_submit').length, 2);
  assert.equal(f.store.getIntake(first.id)?.jobId, 'job-intake-2');
});

test('terminal remote job without a brief becomes a recoverable checkpoint', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const first = await f.service.analyze(f.intake.id);
  f.store.updateIntake(first.id, { status: 'synthesizing' });
  f.setStatus('succeeded');

  const refreshed = await f.service.refresh(first.id);

  assert.equal(refreshed.status, 'blocked');
});

test('a succeeded launcher job remains active while its detached intake worker is alive', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const first = await f.service.analyze(f.intake.id);
  const pidPath = join(f.project.workspace, '.builder', 'intake', first.id, 'worker.pid');
  writeFileSync(pidPath, String(process.pid));
  f.store.updateIntake(first.id, { status: 'inspecting' });
  f.setStatus('succeeded');

  const refreshed = await f.service.refresh(first.id);

  assert.equal(refreshed.status, 'inspecting');
  assert.equal(f.calls.filter((call) => call.tool === 'job_status').length, 0);
});

test('live reconciliation automatically queues recovery from a blocked checkpoint', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const first = await f.service.analyze(f.intake.id);
  f.store.updateIntake(first.id, { status: 'blocked' });
  f.setStatus('succeeded');

  const recovered = await f.service.reconcile(first.id);

  assert.equal(recovered.jobId, 'job-intake-2');
  assert.equal(recovered.status, 'queued');
});
