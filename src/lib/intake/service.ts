import { join } from 'node:path';

import { callComputer2 as defaultComputer2Caller } from '../computer2-mcp.ts';
import { IntakeStore, getIntakeStore } from './store.ts';

type Computer2Caller = (tool: string, args?: Record<string, unknown>) => Promise<unknown>;

function record(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function pickId(value: unknown, names: string[]) {
  const item = record(value);
  for (const name of names) if (typeof item[name] === 'string' && item[name]) return String(item[name]);
  return '';
}

export class IntakeService {
  private store: IntakeStore;
  private caller: Computer2Caller;
  private databasePath: string;
  private workerPath: string;

  constructor(options: { store: IntakeStore; callComputer2: Computer2Caller; databasePath: string; workerPath: string }) {
    this.store = options.store;
    this.caller = options.callComputer2;
    this.databasePath = options.databasePath;
    this.workerPath = options.workerPath;
  }

  async analyze(intakeId: string) {
    const intake = this.store.getIntake(intakeId);
    if (!intake) throw new Error(`Unknown intake: ${intakeId}`);
    const project = this.store.getProject(intake.projectId);
    if (!project) throw new Error(`Unknown project: ${intake.projectId}`);
    if (intake.jobId) return intake;

    const plan = await this.caller('plan_create', {
      goal: `Understand all locally retained source evidence for ${project.name} and synthesize a source-grounded Build Brief. Every visual page must be inspected before approval.`,
      context: { source: 'autonomous-project-builder', project_id: project.id, intake_id: intake.id, stage: 'understanding' },
      cwd: project.workspace,
    });
    const planId = pickId(plan, ['plan_id', 'planId', 'id']);
    if (!planId) throw new Error('Computer 2 did not return an intake plan id');
    let updated = this.store.updateIntake(intake.id, { planId, status: 'queued' });
    this.store.appendEvent(project.id, {
      jobId: '', category: 'plan', stage: 'understanding', severity: 'info', source: 'intake-service', target: 'computer-2',
      humanMessage: 'Document understanding plan created.', technicalPayload: { planId },
    });

    const command = `node "${this.workerPath.replaceAll('"', '\\"')}" --database "${this.databasePath.replaceAll('"', '\\"')}" --intake "${intake.id}"`;
    const job = await this.caller('job_submit', {
      tool: 'computer_batch',
      arguments: {
        cwd: project.workspace,
        stop_on_error: true,
        actions: [{ type: 'command', command, cwd: project.workspace, timeout_ms: 3_600_000 }],
      },
    });
    const jobId = pickId(job, ['job_id', 'jobId', 'id']);
    if (!jobId) throw new Error('Computer 2 did not return an intake job id');
    updated = this.store.updateIntake(intake.id, { jobId, status: 'queued' });
    this.store.appendEvent(project.id, {
      jobId, category: 'job', stage: 'understanding', severity: 'info', source: 'intake-service', target: 'computer-2',
      humanMessage: 'Document understanding queued on Computer 2.', technicalPayload: { planId, jobId },
    });
    return updated;
  }

  async refresh(intakeId: string) {
    const intake = this.store.getIntake(intakeId);
    if (!intake) throw new Error(`Unknown intake: ${intakeId}`);
    if (!intake.jobId || ['awaiting-approval', 'awaiting-resolution', 'approved', 'failed'].includes(intake.status)) return intake;
    const remote = record(await this.caller('job_status', { job_id: intake.jobId }));
    const status = String(remote.status || 'unknown');
    if (status === 'running' || status === 'queued') return this.store.updateIntake(intake.id, { status: status === 'running' ? 'inspecting' : 'queued' });
    if (status === 'cancelled' || status === 'failed') return this.store.updateIntake(intake.id, { status: 'failed' });
    if (status === 'succeeded') {
      await this.caller('job_result', { job_id: intake.jobId, full: true });
      return this.store.getIntake(intake.id)!;
    }
    return this.store.updateIntake(intake.id, { status: 'blocked' });
  }

  async cancel(intakeId: string) {
    const intake = this.store.getIntake(intakeId);
    if (!intake) throw new Error(`Unknown intake: ${intakeId}`);
    if (intake.jobId) await this.caller('job_cancel', { job_id: intake.jobId });
    this.store.updateProject(intake.projectId, { state: 'cancelled' });
    return this.store.updateIntake(intake.id, { status: 'failed' });
  }

  async resumeInterrupted() {
    const response = record(await this.caller('job_resume', {}));
    const refreshed = [];
    for (const project of this.unfinishedProjects()) {
      const intake = project.currentIntakeId ? this.store.getIntake(project.currentIntakeId) : null;
      if (intake?.jobId) refreshed.push(await this.refresh(intake.id));
    }
    return { resumedCount: Number(response.resumed_count || 0), intakes: refreshed };
  }

  private unfinishedProjects() {
    const candidates = new Set(this.store.allProjects().filter((project) => ['understanding', 'draft'].includes(project.state)).map((project) => project.id));
    return [...candidates].map((id) => this.store.getProject(id)!).filter(Boolean);
  }
}

const globalService = globalThis as typeof globalThis & { __autonomousIntakeService?: IntakeService };

export function getIntakeService() {
  if (!globalService.__autonomousIntakeService) {
    const databasePath = process.env.BUILDER_STATE_DB?.trim() || join(process.cwd(), '.builder', 'state.db');
    const workerPath = process.env.BUILDER_INTAKE_WORKER?.trim() || join(process.cwd(), 'dist-worker', 'intake-worker.mjs');
    globalService.__autonomousIntakeService = new IntakeService({ store: getIntakeStore(), callComputer2: defaultComputer2Caller, databasePath, workerPath });
  }
  return globalService.__autonomousIntakeService;
}
