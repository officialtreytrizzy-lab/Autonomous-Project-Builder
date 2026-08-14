import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BuildStore } from '../src/lib/build-store.ts';
import { BuildService } from '../src/lib/build-service.ts';

const passedChecks = ['dependencies', 'lint', 'typecheck', 'unit-tests', 'integration-tests', 'production-build', 'critical-flows', 'runtime', 'http', 'placeholder-audit']
  .map((name) => ({ name, status: 'passed', detail: `${name} passed` }));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'builder-service-'));
  const store = new BuildStore(join(directory, 'state.db'));
  const calls = [];
  let jobStatus = { job_id: 'job-1', status: 'running', attempt: 1, retryCount: 0 };
  let statusError = null;
  const caller = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'plan_create') return { id: 'plan-1' };
    if (tool === 'job_submit') return { job_id: 'job-1', status: 'queued' };
    if (tool === 'job_status' && statusError) { const error = statusError; statusError = null; throw error; }
    if (tool === 'job_status') return jobStatus;
    if (tool === 'job_result') return { job_id: 'job-1', status: jobStatus.status, result: { captured: true } };
    if (tool === 'job_cancel') return { job_id: 'job-1', status: 'cancelled' };
    if (tool === 'job_resume') return { resumed_count: 1 };
    throw new Error(`Unexpected tool ${tool}`);
  };
  const service = new BuildService({ store, callComputer2: caller, projectsRoot: join(directory, 'projects'), allocatePort: async () => 3241 });
  return {
    directory, store, calls, service,
    setJobStatus(value) { jobStatus = value; },
    failNextStatus(error) { statusError = error; },
    close() { store.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

test('local request creates a real persisted Computer 2 job without GitHub', async () => {
  const f = fixture();
  try {
    const build = await f.service.start({ name: 'Smoke', objective: 'Render LOCAL E2E PASS', repository: '', deployment: 'local', backend: 'none', workflow: 'none' });
    assert.equal(build.status, 'queued');
    assert.equal(build.planId, 'plan-1');
    assert.equal(build.jobId, 'job-1');
    const submit = f.calls.find((call) => call.tool === 'job_submit');
    assert.equal(submit.args.tool, 'computer_batch');
    assert.equal(submit.args.arguments.cwd, build.workspace);
    assert.equal(submit.args.arguments.actions[0].command.includes('LOCAL E2E PASS'), false);
    assert.equal(f.store.get(build.id)?.jobId, 'job-1');
    assert.equal(f.calls.some((call) => call.tool === 'plan_create'), true);
  } finally { f.close(); }
});

test('job status and completion evidence drive the authoritative result', async () => {
  const f = fixture();
  try {
    const build = await f.service.start({ name: 'Smoke', objective: 'Render pass', deployment: 'local', backend: 'none', workflow: 'none' });
    const running = await f.service.refresh(build.id);
    assert.equal(running.status, 'running');

    writeFileSync(join(build.workspace, '.builder', 'completion.json'), JSON.stringify({
      status: 'complete', appUrl: 'http://127.0.0.1:3241', verification: passedChecks, repairs: [], result: { summary: 'done' },
    }));
    f.setJobStatus({ job_id: 'job-1', status: 'succeeded', attempt: 2, retryCount: 1 });
    const complete = await f.service.refresh(build.id);
    assert.equal(complete.status, 'complete');
    assert.equal(complete.appUrl, 'http://127.0.0.1:3241');
    assert.equal(complete.retryCount, 1);
    assert.equal(complete.verification.length, 10);
  } finally { f.close(); }
});

test('completion cleans up the detached implementation worker through Computer 2', async () => {
  const f = fixture();
  try {
    const build = await f.service.start({ name: 'Cleanup', objective: 'finish cleanly', deployment: 'local' });
    writeFileSync(join(build.workspace, '.builder', 'worker.pid'), '424242');
    writeFileSync(join(build.workspace, '.builder', 'completion.json'), JSON.stringify({
      status: 'complete', appUrl: 'http://127.0.0.1:3241', verification: passedChecks, repairs: [], result: { summary: 'done' },
    }));
    f.setJobStatus({ job_id: 'job-1', status: 'succeeded', attempt: 1, retryCount: 0 });
    await f.service.refresh(build.id);
    const termination = f.calls.find((call) => call.tool === 'computer_batch');
    assert.match(termination?.args?.actions?.[0]?.command || '', /taskkill \/PID 424242 \/T \/F/);
    assert.match(termination?.args?.actions?.[1]?.command || '', /Get-CimInstance Win32_Process/);
    assert.match(termination?.args?.actions?.[1]?.command || '', new RegExp(build.workspace.replaceAll('\\', '\\\\')));
  } finally { f.close(); }
});

test('a completed launch job remains running while its detached worker is alive', async () => {
  const f = fixture();
  try {
    const build = await f.service.start({ name: 'Detached', objective: 'keep building', deployment: 'local' });
    writeFileSync(join(build.workspace, '.builder', 'worker.pid'), String(process.pid));
    f.setJobStatus({ job_id: 'job-1', status: 'succeeded', attempt: 1, retryCount: 0 });
    const running = await f.service.refresh(build.id);
    assert.equal(running.status, 'running');
    assert.match(running.currentStep, /detached/i);
  } finally { f.close(); }
});

test('MCP disconnect is classified as interrupted and a later refresh reconnects', async () => {
  const f = fixture();
  try {
    const build = await f.service.start({ objective: 'recover', deployment: 'local' });
    f.failNextStatus(new Error('ECONNREFUSED connecting to MCP'));
    const interrupted = await f.service.refresh(build.id);
    assert.equal(interrupted.status, 'interrupted');
    assert.equal(interrupted.errors.at(-1).errorClass, 'transient/network');
    f.setJobStatus({ job_id: 'job-1', status: 'running', attempt: 2, retryCount: 1 });
    const reconnected = await f.service.refresh(build.id);
    assert.equal(reconnected.status, 'running');
  } finally { f.close(); }
});

test('cancellation and interrupted-job resume are delegated to Computer 2', async () => {
  const f = fixture();
  try {
    const build = await f.service.start({ objective: 'cancel me', deployment: 'local' });
    const cancelled = await f.service.cancel(build.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(f.calls.some((call) => call.tool === 'job_cancel'), true);

    const resumed = await f.service.resumeInterrupted();
    assert.equal(resumed.resumedCount, 1);
    assert.equal(f.calls.some((call) => call.tool === 'job_resume'), true);
  } finally { f.close(); }
});

test('cancellation terminates a detached worker process tree through Computer 2', async () => {
  const f = fixture();
  try {
    const build = await f.service.start({ objective: 'cancel detached worker', deployment: 'local' });
    writeFileSync(join(build.workspace, '.builder', 'worker.pid'), '424242');
    await f.service.cancel(build.id);
    const termination = f.calls.find((call) => call.tool === 'computer_batch');
    assert.match(termination?.args?.actions?.[0]?.command || '', /taskkill \/PID 424242 \/T \/F/);
  } finally { f.close(); }
});

test('rerun verification creates a new durable job against the same workspace', async () => {
  const f = fixture();
  try {
    const build = await f.service.start({ objective: 'verify again', deployment: 'local' });
    const rerun = await f.service.rerunVerification(build.id);
    assert.equal(rerun.status, 'queued');
    assert.equal(rerun.workspace, build.workspace);
    assert.equal(f.calls.filter((call) => call.tool === 'job_submit').length, 2);
  } finally { f.close(); }
});

test('Windmill-targeted build creates and persists a real durable orchestration job', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'builder-windmill-'));
  const store = new BuildStore(join(directory, 'state.db'));
  const windmillCalls = [];
  const computerCalls = [];
  const caller = async (tool, args) => {
    computerCalls.push({ tool, args });
    if (tool === 'plan_create') return { id: 'plan-wm-1' };
    if (tool === 'job_submit') return { job_id: 'job-wm-1', status: 'queued' };
    if (tool === 'job_cancel') return { job_id: 'job-wm-1', status: 'cancelled' };
    throw new Error(`Unexpected Computer 2 tool ${tool}`);
  };
  const windmill = async (tool, args) => {
    windmillCalls.push({ tool, args });
    if (tool === 'deleteScriptByPath') return 'deleted';
    if (tool === 'createScript') return 'created';
    if (tool === 'runScriptByPath') return '019ffef4-8e64-e218-0d13-cdb445a1722a';
    throw new Error(`Unexpected Windmill tool ${tool}`);
  };
  let cancelledWindmill = '';
  const service = new BuildService({
    store,
    callComputer2: caller,
    projectsRoot: join(directory, 'projects'),
    allocatePort: async () => 3241,
    callWindmill: windmill,
    cancelWindmill: async (jobId) => { cancelledWindmill = jobId; return true; },
    windmillConfigured: () => true,
  });
  try {
    const build = await service.start({ name: 'Durable', objective: 'Use a durable workflow', deployment: 'local', workflow: 'windmill' });
    const checkpoint = build.checkpoints.find((item) => item.windmillJobId);
    assert.equal(build.status, 'queued');
    assert.equal(checkpoint?.windmillJobId, '019ffef4-8e64-e218-0d13-cdb445a1722a');
    assert.match(String(checkpoint?.windmillScriptPath), /^u\/admin\/autonomous_builder_/);
    assert.deepEqual(windmillCalls.map((call) => call.tool), ['deleteScriptByPath', 'createScript', 'runScriptByPath']);
    const create = windmillCalls.find((call) => call.tool === 'createScript');
    assert.match(create.args.content, /host\.docker\.internal:3107\/api\/builds\/status\?build_id=/);
    await service.cancel(build.id);
    assert.equal(cancelledWindmill, '019ffef4-8e64-e218-0d13-cdb445a1722a');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('unavailable Windmill is capability degradation and does not block the Computer 2 build', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'builder-windmill-yellow-'));
  const store = new BuildStore(join(directory, 'state.db'));
  const caller = async (tool) => {
    if (tool === 'plan_create') return { id: 'plan-yellow' };
    if (tool === 'job_submit') return { job_id: 'job-yellow', status: 'queued' };
    throw new Error(`Unexpected tool ${tool}`);
  };
  const service = new BuildService({
    store,
    callComputer2: caller,
    projectsRoot: join(directory, 'projects'),
    allocatePort: async () => 3241,
    callWindmill: async () => { throw new Error('Windmill should not be called while unconfigured'); },
    windmillConfigured: () => false,
  });
  try {
    const build = await service.start({ objective: 'Durable but recoverable', deployment: 'local', workflow: 'windmill' });
    assert.equal(build.status, 'queued');
    assert.equal(build.errors.at(-1)?.errorClass, 'configuration');
    assert.match(build.errors.at(-1)?.message || '', /Windmill orchestration is requested/);
    assert.equal(build.jobId, 'job-yellow');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
