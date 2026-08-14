import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { callComputer2 as defaultComputer2Caller } from '../computer2-mcp.ts';
import { discoverDocumentCapabilities, type DocumentCapabilityReport } from './capabilities.ts';
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

const activeIntakeStatuses = ['queued', 'extracting', 'rendering', 'inspecting', 'synthesizing'];

function escapePowerShell(value: string) {
  return value.replaceAll("'", "''");
}

export function prepareIntakeWorkerLaunch(input: {
  workspace: string;
  intakeId: string;
  workerPath: string;
  databasePath: string;
  pdfRendererPath?: string;
}) {
  const controlDirectory = join(input.workspace, '.builder', 'intake', input.intakeId);
  const workerScriptPath = join(controlDirectory, 'intake-worker.ps1');
  const launcherPath = join(controlDirectory, 'intake-launch.ps1');
  const pidPath = join(controlDirectory, 'worker.pid');
  mkdirSync(controlDirectory, { recursive: true });
  rmSync(pidPath, { force: true });
  const renderer = input.pdfRendererPath ? ` --pdf-renderer '${escapePowerShell(input.pdfRendererPath)}'` : '';
  const workerScript = `$ErrorActionPreference = 'Stop'
$PID | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'worker.pid')
$stdout = Join-Path $PSScriptRoot 'worker.stdout.log'
$stderr = Join-Path $PSScriptRoot 'worker.stderr.log'
$node = (Get-Command node.exe -ErrorAction Stop).Source
try {
  $ErrorActionPreference = 'Continue'
  & $node '${escapePowerShell(input.workerPath)}' --database '${escapePowerShell(input.databasePath)}' --intake '${escapePowerShell(input.intakeId)}'${renderer} 1> $stdout 2> $stderr
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($exitCode -ne 0) { throw "Intake worker exited with code $exitCode" }
} catch {
  Add-Content -LiteralPath $stderr -Value ($_ | Out-String)
  throw
}
`;
  const taskName = `AutonomousBuilder-Intake-${input.intakeId.replace(/[^a-zA-Z0-9-]/g, '')}`;
  const launcher = `$ErrorActionPreference = 'Stop'
$taskName = '${taskName}'
$argument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${workerScriptPath.replaceAll('"', '`"')}"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory '${escapePowerShell(input.workspace)}'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddYears(10)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
[pscustomobject]@{ launched = $true; task = $taskName } | ConvertTo-Json -Compress
`;
  writeFileSync(workerScriptPath, workerScript, { encoding: 'utf8', mode: 0o700 });
  writeFileSync(launcherPath, launcher, { encoding: 'utf8', mode: 0o700 });
  return {
    controlDirectory,
    pidPath,
    workerScriptPath,
    launcherPath,
    command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${launcherPath.replaceAll('"', '`"')}"`,
  };
}

export class IntakeService {
  private store: IntakeStore;
  private caller: Computer2Caller;
  private databasePath: string;
  private workerPath: string;
  private discoverCapabilities: () => Promise<DocumentCapabilityReport>;

  constructor(options: {
    store: IntakeStore;
    callComputer2: Computer2Caller;
    databasePath: string;
    workerPath: string;
    discoverCapabilities?: () => Promise<DocumentCapabilityReport>;
  }) {
    this.store = options.store;
    this.caller = options.callComputer2;
    this.databasePath = options.databasePath;
    this.workerPath = options.workerPath;
    this.discoverCapabilities = options.discoverCapabilities || discoverDocumentCapabilities;
  }

  async analyze(intakeId: string) {
    const intake = this.store.getIntake(intakeId);
    if (!intake) throw new Error(`Unknown intake: ${intakeId}`);
    const project = this.store.getProject(intake.projectId);
    if (!project) throw new Error(`Unknown project: ${intake.projectId}`);
    if (intake.jobId && intake.status !== 'blocked') return intake;

    let planId = intake.planId;
    let updated = intake;
    if (!planId) {
      const plan = await this.caller('plan_create', {
        goal: `Understand all locally retained source evidence for ${project.name} and synthesize a source-grounded Build Brief. Every visual page must be inspected before approval.`,
        context: { source: 'autonomous-project-builder', project_id: project.id, intake_id: intake.id, stage: 'understanding' },
        cwd: project.workspace,
      });
      planId = pickId(plan, ['plan_id', 'planId', 'id']);
      if (!planId) throw new Error('Computer 2 did not return an intake plan id');
      updated = this.store.updateIntake(intake.id, { planId, status: 'queued' });
      this.store.appendEvent(project.id, {
        jobId: '', category: 'plan', stage: 'understanding', severity: 'info', source: 'intake-service', target: 'computer-2',
        humanMessage: 'Document understanding plan created.', technicalPayload: { planId },
      });
    }
    if (intake.jobId) updated = this.store.updateIntake(intake.id, { status: 'queued' });

    const capability = await this.discoverCapabilities();
    const launch = prepareIntakeWorkerLaunch({
      workspace: project.workspace,
      intakeId: intake.id,
      workerPath: this.workerPath,
      databasePath: this.databasePath,
      pdfRendererPath: capability.pdfRenderer.path,
    });
    const job = await this.caller('job_submit', {
      tool: 'computer_batch',
      arguments: {
        cwd: project.workspace,
        stop_on_error: true,
        actions: [{ type: 'command', command: launch.command, cwd: project.workspace, timeout_ms: 30_000 }],
      },
    });
    const jobId = pickId(job, ['job_id', 'jobId', 'id']);
    if (!jobId) throw new Error('Computer 2 did not return an intake job id');
    updated = this.store.updateIntake(intake.id, { jobId, status: 'queued' });
    this.store.appendEvent(project.id, {
      jobId, category: 'job', stage: 'understanding', severity: 'info', source: 'intake-service', target: 'computer-2',
      humanMessage: intake.jobId ? 'Document understanding recovery queued from its last checkpoint.' : 'Document understanding queued on Computer 2.',
      technicalPayload: { planId, jobId, ...(intake.jobId ? { previousJobId: intake.jobId } : {}) },
    });
    return updated;
  }

  async refresh(intakeId: string) {
    const intake = this.store.getIntake(intakeId);
    if (!intake) throw new Error(`Unknown intake: ${intakeId}`);
    if (!intake.jobId || ['awaiting-approval', 'awaiting-resolution', 'approved', 'failed'].includes(intake.status)) return intake;
    const project = this.store.getProject(intake.projectId);
    if (project && activeIntakeStatuses.includes(intake.status) && this.workerIsAlive(project.workspace, intake.id)) return intake;
    const remote = record(await this.caller('job_status', { job_id: intake.jobId }));
    const status = String(remote.status || 'unknown');
    if (status === 'running' || status === 'queued') return this.store.updateIntake(intake.id, { status: status === 'running' ? 'inspecting' : 'queued' });
    if (status === 'cancelled' || status === 'failed') return this.store.updateIntake(intake.id, { status: 'failed' });
    if (status === 'succeeded') {
      await this.caller('job_result', { job_id: intake.jobId, full: true });
      const latest = this.store.getIntake(intake.id)!;
      if (activeIntakeStatuses.includes(latest.status)) {
        if (project && this.workerIsAlive(project.workspace, latest.id)) return latest;
        return this.store.updateIntake(intake.id, { status: 'blocked' });
      }
      return latest;
    }
    return this.store.updateIntake(intake.id, { status: 'blocked' });
  }

  async cancel(intakeId: string) {
    const intake = this.store.getIntake(intakeId);
    if (!intake) throw new Error(`Unknown intake: ${intakeId}`);
    if (intake.jobId) await this.caller('job_cancel', { job_id: intake.jobId });
    const project = this.store.getProject(intake.projectId);
    const workerPid = project ? this.readWorkerPid(project.workspace, intake.id) : null;
    if (workerPid) {
      await this.caller('computer_batch', {
        cwd: project!.workspace,
        stop_on_error: false,
        actions: [{ type: 'command', command: `taskkill /PID ${workerPid} /T /F`, cwd: project!.workspace, timeout_ms: 30_000 }],
      }).catch(() => undefined);
    }
    this.store.updateProject(intake.projectId, { state: 'cancelled' });
    return this.store.updateIntake(intake.id, { status: 'failed' });
  }

  async reconcile(intakeId: string) {
    const current = await this.refresh(intakeId);
    if (current.status !== 'blocked') return current;
    try {
      return await this.analyze(current.id);
    } catch (error) {
      this.store.updateIntake(current.id, { status: 'blocked' });
      throw error;
    }
  }

  async resumeInterrupted() {
    const response = record(await this.caller('job_resume', {}));
    const refreshed = [];
    for (const project of this.unfinishedProjects()) {
      const intake = project.currentIntakeId ? this.store.getIntake(project.currentIntakeId) : null;
      if (intake?.jobId) {
        let current = await this.refresh(intake.id);
        if (current.status === 'blocked') current = await this.analyze(current.id);
        refreshed.push(current);
      }
    }
    return { resumedCount: Number(response.resumed_count || 0), intakes: refreshed };
  }

  private unfinishedProjects() {
    const candidates = new Set(this.store.allProjects().filter((project) => ['understanding', 'draft'].includes(project.state)).map((project) => project.id));
    return [...candidates].map((id) => this.store.getProject(id)!).filter(Boolean);
  }

  private readWorkerPid(workspace: string, intakeId: string) {
    try {
      const value = Number(readFileSync(join(workspace, '.builder', 'intake', intakeId, 'worker.pid'), 'utf8').trim());
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch { return null; }
  }

  private workerIsAlive(workspace: string, intakeId: string) {
    const pid = this.readWorkerPid(workspace, intakeId);
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
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
