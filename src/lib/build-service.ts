import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';
import { analyzeBuild, APPROVAL_CONTINUATION_POLICY, type BuildRequest } from './builder.ts';
import { BuildStore, defaultProjectsRoot, getBuildStore, type BuildRecord, type BuildStatus } from './build-store.ts';
import { classifyBuildError, prepareBuildWorkspace, validateCompletionEvidence, writeApprovedBrief, writeApprovedDesign, type CompletionEvidence } from './build-execution.ts';
import { callComputer2 as defaultComputer2Caller } from './computer2-mcp.ts';
import { callWindmill as defaultWindmillCaller, cancelWindmillJob as defaultCancelWindmillJob, windmillConfigured as defaultWindmillConfigured } from './windmill-mcp.ts';
import { openRouterConfigured } from './ai/openrouter.ts';
import { DesignService } from './design/service.ts';
import type { DesignContract, DesignVisualQa } from './design/types';
import { computeApprovalHash } from './intake/contract.ts';
import { getIntakeStore, IntakeStore } from './intake/store.ts';
import type { ApprovalBuildConfiguration, BriefDecision, BuildBrief, SourceManifestItem } from './intake/types.ts';
import { readWorkerEventBatch } from './intake/worker-events.ts';
import { buildRequirementRuntimeBundle, requirementContract, resolveRequirementStates, writeBuildRequirementBundle } from './intake/requirements.ts';
import { defaultTarget, requiredArtifactExtensionGroups, targetIsWebRuntime, targetLabel } from './target-platform.ts';

type Computer2Caller = (tool: string, args?: Record<string, unknown>) => Promise<unknown>;
type WindmillCaller = (tool: string, args?: Record<string, unknown>) => Promise<unknown>;
type WindmillCancel = (jobId: string, reason?: string) => Promise<unknown>;
type DesignReviewer = (intakeId: string, screenshots: Array<{ label: string; dataUrl: string }>, threshold?: number) => Promise<DesignVisualQa>;

function pickId(value: unknown, names: string[]) {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const name of names) if (typeof record[name] === 'string' && record[name]) return String(record[name]);
  return '';
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

async function isPortFree(port: number) {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function allocateProjectPort() {
  for (let port = 3200; port <= 3399; port += 1) if (await isPortFree(port)) return port;
  throw new Error('No private local application port is available between 3200 and 3399');
}

export class BuildService {
  private store: BuildStore;
  private caller: Computer2Caller;
  private projectsRoot: string;
  private allocatePort: () => Promise<number>;
  private intakeStore?: IntakeStore;
  private windmillCaller: WindmillCaller;
  private windmillCancel: WindmillCancel;
  private windmillConfigured: () => boolean;
  private designQaConfigured: () => boolean;
  private designReviewer: DesignReviewer;

  constructor(options: {
    store: BuildStore;
    intakeStore?: IntakeStore;
    callComputer2: Computer2Caller;
    projectsRoot: string;
    allocatePort?: () => Promise<number>;
    callWindmill?: WindmillCaller;
    cancelWindmill?: WindmillCancel;
    windmillConfigured?: () => boolean;
    designQaConfigured?: () => boolean;
    reviewDesign?: DesignReviewer;
  }) {
    this.store = options.store;
    this.caller = options.callComputer2;
    this.projectsRoot = options.projectsRoot;
    this.allocatePort = options.allocatePort || allocateProjectPort;
    this.intakeStore = options.intakeStore;
    this.windmillCaller = options.callWindmill || defaultWindmillCaller;
    this.windmillCancel = options.cancelWindmill || defaultCancelWindmillJob;
    this.windmillConfigured = options.windmillConfigured || defaultWindmillConfigured;
    this.designQaConfigured = options.designQaConfigured || openRouterConfigured;
    this.designReviewer = options.reviewDesign || (async (intakeId, screenshots, threshold) => {
      if (!this.intakeStore) throw new Error('Design QA requires the intake store');
      return new DesignService(this.intakeStore).reviewImplementation(intakeId, screenshots, threshold);
    });
  }

  private emit(build: BuildRecord, input: {
    category: string;
    stage: string;
    severity: 'info' | 'success' | 'warning' | 'error';
    humanMessage: string;
    technicalPayload?: unknown;
  }) {
    if (!this.intakeStore?.getProject(build.projectId)) return;
    this.intakeStore.appendEvent(build.projectId, {
      ...input,
      buildId: build.id,
      jobId: build.jobId,
      source: 'build-service',
      target: 'computer-2',
    });
  }

  private ingestWorkerEvents(build: BuildRecord) {
    if (!build.workspace || !this.intakeStore?.getProject(build.projectId)) return build;
    const batch = readWorkerEventBatch(join(build.workspace, '.builder', 'worker.events.jsonl'), build.workerEventOffset || 0);
    for (const event of batch.events) this.emit(build, event);
    return batch.nextOffset === (build.workerEventOffset || 0)
      ? build
      : this.store.update(build.id, { workerEventOffset: batch.nextOffset });
  }

  private updateProjectState(build: BuildRecord, state: 'building' | 'blocked' | 'failed' | 'cancelled' | 'complete') {
    if (!this.intakeStore?.getProject(build.projectId)) return;
    this.intakeStore.updateProject(build.projectId, { state, activeBuildId: build.id });
  }

  async startApproved(input: { intakeId: string; approvalHash: string }) {
    if (!input.approvalHash.trim()) throw new Error('Approval required before a build can start');
    if (!this.intakeStore) throw new Error('Approval store is not configured');
    const intake = this.intakeStore.getIntake(input.intakeId);
    if (!intake) throw new Error(`Unknown intake: ${input.intakeId}`);
    const project = this.intakeStore.getProject(intake.projectId);
    if (!project) throw new Error(`Unknown project: ${intake.projectId}`);
    const approval = this.intakeStore.currentApproval(input.intakeId);
    if (!approval) throw new Error('Approval required before a build can start');
    if (approval.hash !== input.approvalHash) throw new Error('Approval no longer matches the current build contract');
    const brief = this.intakeStore.currentBrief(input.intakeId);
    if (!brief || brief.id !== approval.briefVersionId) throw new Error('Approval no longer matches the current Build Brief');
    if (!brief.visualCoverage.complete) throw new Error('Visual inspection is incomplete; approval cannot start execution');
    const sources = this.intakeStore.currentSources(input.intakeId);
    const decisions = this.intakeStore.decisionsForBrief(brief.id);
    if (decisions.some((decision) => decision.required && !decision.resolution.trim())) throw new Error('Approval requires all user-only decisions to be resolved');
    const requirementStates = resolveRequirementStates(this.intakeStore, input.intakeId);
    const missingRequirements = requirementStates.filter((state) => state.requirement.required && !state.satisfied);
    if (missingRequirements.length) throw new Error(`Approval requires all user-supplied build inputs: ${missingRequirements.map((item) => item.requirement.label).join(', ')}`);
    const requirementMaterial = requirementContract(this.intakeStore, input.intakeId);
    const requirementBundle = await buildRequirementRuntimeBundle(this.intakeStore, input.intakeId);
    const designSession = this.intakeStore.currentDesignSession(input.intakeId);
    const design = this.intakeStore.currentDesignContract(input.intakeId);
    const approvedDesign = design && designSession?.status === 'approved' ? design : undefined;
    const recomputed = approvedDesign
      ? computeApprovalHash({ brief, sources, decisions, design: approvedDesign, requirements: requirementMaterial, buildConfiguration: approval.buildConfiguration })
      : computeApprovalHash({ brief, sources, decisions, requirements: requirementMaterial, buildConfiguration: approval.buildConfiguration });
    if (recomputed !== approval.hash || recomputed !== input.approvalHash) throw new Error('Approval no longer matches the current build contract');
    const request: BuildRequest = {
      name: project.name,
      objective: brief.content.outcome,
      repository: approval.buildConfiguration.repository,
      backend: approval.buildConfiguration.backend,
      deployment: approval.buildConfiguration.deployment,
      workflow: approval.buildConfiguration.workflow,
      needsAuthenticatedBrowser: approval.buildConfiguration.needsAuthenticatedBrowser,
      needsWindowsHost: approval.buildConfiguration.needsWindowsHost,
      target: approval.buildConfiguration.target || project.buildTarget || defaultTarget(),
    };
    const build = await this.start(request, {
      projectId: project.id,
      intakeId: intake.id,
      brief,
      sources,
      decisions,
      design: approvedDesign,
      config: approval.buildConfiguration,
      approvalHash: approval.hash,
      workspace: project.workspace,
      existingWorkspace: project.workspaceMode === 'existing',
      requirementBundle,
    });
    this.updateProjectState(build, build.status === 'blocked' ? 'blocked' : 'building');
    return build;
  }

  async start(request: BuildRequest, approved?: {
    projectId: string;
    intakeId: string;
    brief: BuildBrief;
    sources: SourceManifestItem[];
    decisions: BriefDecision[];
    design?: DesignContract;
    config: ApprovalBuildConfiguration;
    approvalHash: string;
    workspace: string;
    existingWorkspace: boolean;
    requirementBundle: Awaited<ReturnType<typeof buildRequirementRuntimeBundle>>;
  }): Promise<BuildRecord> {
    const analysis = analyzeBuild(request);
    const initial = this.store.create({
      request, analysis, workspace: approved?.workspace || this.projectsRoot,
      ...(approved ? {
        projectId: approved.projectId,
        intakeId: approved.intakeId,
        briefVersionId: approved.brief.id,
        approvalHash: approved.approvalHash,
      } : {}),
    });
    if (!analysis.canContinue) {
      const blocked = this.store.update(initial.id, { status: 'blocked', currentStage: 'blocked', currentStep: 'Waiting for required user input', finishedAt: new Date().toISOString() });
      this.store.appendLog(blocked.id, { step: 'analysis', target: 'user', errorClass: 'user-required input', message: 'Build contains a genuinely blocking RED ingredient.' });
      return blocked;
    }

    try {
      const port = await this.allocatePort();
      const prepared = prepareBuildWorkspace({
        root: this.projectsRoot,
        buildId: initial.id,
        port,
        request,
        steps: analysis.steps,
        workspace: approved?.workspace,
        existingWorkspace: approved?.existingWorkspace,
      });
      if (approved) writeApprovedBrief({
        workspace: prepared.workspace,
        brief: approved.brief,
        sources: approved.sources,
        decisions: approved.decisions,
        buildConfiguration: approved.config,
        approvalHash: approved.approvalHash,
      });
      if (approved?.design) writeApprovedDesign({ workspace: prepared.workspace, design: approved.design, approvalHash: approved.approvalHash });
      if (approved) writeBuildRequirementBundle(prepared.workspace, approved.requirementBundle, approved.approvalHash);
      let build = this.store.update(initial.id, { workspace: prepared.workspace, currentStep: 'Registering execution plan' });
      this.store.appendLog(build.id, { step: 'workspace', target: 'computer-2', tool: 'local-filesystem', result: { workspace: prepared.workspace, port } });
      this.emit(build, {
        category: 'stage',
        stage: 'planning',
        severity: 'info',
        humanMessage: approved?.existingWorkspace
          ? 'Attached the selected existing application workspace for in-place modification.'
          : 'Prepared the private local project workspace.',
      });

      const goal = [
        `Project: ${request.name || 'Private local project'}`,
        `Objective: ${request.objective || ''}`,
        `Workspace: ${prepared.workspace}`,
        `Operating rule: ${APPROVAL_CONTINUATION_POLICY}`,
        'Inspect existing resources before requesting anything from the user.',
        'Execute the supplied local worker script through the durable Computer 2 job runner.',
      ].join('\n');
      const plan = await this.caller('plan_create', {
        goal,
        context: { source: 'autonomous-project-builder', build_id: build.id, executionPlan: analysis.steps },
        cwd: prepared.workspace,
      });
      const planId = pickId(plan, ['plan_id', 'planId', 'id']);
      if (!planId) throw new Error('Computer 2 did not return a plan id');
      build = this.store.update(build.id, { planId, currentStage: 'queued', currentStep: 'Submitting durable execution job' });
      this.store.appendLog(build.id, { step: 'plan', target: 'computer-2', tool: 'plan_create', result: { planId } });
      this.emit(build, { category: 'stage', stage: 'planning', severity: 'success', humanMessage: 'Registered the approved execution plan.', technicalPayload: { planId } });

      const job = await this.caller('job_submit', {
        tool: 'computer_batch',
        arguments: {
          cwd: prepared.workspace,
          stop_on_error: true,
          actions: [{ type: 'command', command: prepared.command, cwd: prepared.workspace, timeout_ms: 600_000 }],
        },
      });
      const jobId = pickId(job, ['job_id', 'jobId', 'id']);
      if (!jobId) throw new Error('Computer 2 did not return a job id');
      build = this.store.update(build.id, {
        jobId,
        status: 'queued',
        currentStage: 'execution',
        currentStep: 'Waiting for Computer 2 worker',
        startedAt: new Date().toISOString(),
      });
      this.store.appendLog(build.id, { step: 'job', target: 'computer-2', tool: 'job_submit', result: { jobId, status: 'queued' } });
      this.emit(build, { category: 'stage', stage: 'implementation', severity: 'info', humanMessage: 'Queued autonomous implementation on Computer 2.', technicalPayload: { jobId } });
      if (analysis.steps.some((step) => step.target === 'windmill')) build = await this.startWindmillOrchestration(build);
      return build;
    } catch (error) {
      const errorClass = classifyBuildError(error);
      const blocked = ['authentication', 'configuration', 'user-required input', 'irreversible decision'].includes(errorClass);
      const failed = this.store.update(initial.id, {
        status: blocked ? 'blocked' : 'interrupted',
        currentStage: blocked ? 'blocked' : 'recovery',
        currentStep: blocked ? 'Waiting for required configuration or authorization' : 'Waiting to retry Computer 2 connection',
        errors: [...initial.errors, { timestamp: new Date().toISOString(), errorClass, message: error instanceof Error ? error.message : String(error) }],
      });
      this.store.appendLog(failed.id, { step: 'start', target: 'computer-2', errorClass, result: 'failed', message: error instanceof Error ? error.message : String(error) });
      this.emit(failed, {
        category: blocked ? 'blocked' : 'repair', stage: failed.currentStage, severity: blocked ? 'error' : 'warning',
        humanMessage: blocked ? 'Execution needs a user-only dependency.' : 'Computer 2 connection interrupted; recovery is queued.',
        technicalPayload: { errorClass, repairAction: blocked ? '' : 'Reconnect and resume the persisted job' },
      });
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { build: failed });
    }
  }

  async refresh(buildId: string): Promise<BuildRecord> {
    let build = this.store.get(buildId);
    if (!build) throw new Error(`Unknown build: ${buildId}`);
    build = this.ingestWorkerEvents(build);
    build = await this.refreshWindmill(build);
    if (!build.jobId || ['complete', 'failed', 'cancelled', 'blocked'].includes(build.status)) return build;
    try {
      const remote = recordOf(await this.caller('job_status', { job_id: build.jobId }));
      const remoteStatus = String(remote.status || 'unknown');
      const retryCount = Number(remote.retryCount ?? remote.retry_count ?? build.retryCount) || 0;
      const attempt = Number(remote.attempt ?? retryCount + 1) || 1;
      const statusMap: Record<string, BuildStatus> = { queued: 'queued', running: 'running', interrupted: 'interrupted', cancelled: 'cancelled', failed: 'failed' };
      if (remoteStatus === 'succeeded') return await this.completeFromEvidence(build, remote, retryCount, attempt);
      const nextStatus = statusMap[remoteStatus] || 'interrupted';
      const updated = this.store.update(build.id, {
        status: nextStatus,
        currentStage: nextStatus === 'failed' ? 'verification' : nextStatus === 'interrupted' ? 'recovery' : 'execution',
        currentStep: nextStatus === 'running' ? 'Computer 2 worker is implementing and verifying' : `Remote job is ${remoteStatus}`,
        retryCount,
        finishedAt: ['failed', 'cancelled'].includes(nextStatus) ? new Date().toISOString() : null,
      });
      if (remoteStatus !== build.status || retryCount !== build.retryCount) {
        this.store.appendLog(updated.id, { step: 'job-status', target: 'computer-2', tool: 'job_status', attempt, result: { status: remoteStatus, retryCount } });
        const recovered = build.status === 'interrupted' && nextStatus === 'running';
        this.emit(updated, {
          category: recovered ? 'recovered' : retryCount > build.retryCount ? 'repair' : 'stage',
          stage: updated.currentStage,
          severity: nextStatus === 'failed' ? 'error' : recovered ? 'success' : 'info',
          humanMessage: recovered ? 'Recovered the interrupted Computer 2 job and continued execution.' : `Computer 2 job is ${remoteStatus}.`,
          technicalPayload: { status: remoteStatus, retryCount, attempt },
        });
      }
      if (nextStatus === 'failed') return await this.recordRemoteFailure(updated, remote);
      return updated;
    } catch (error) {
      const errorClass = classifyBuildError(error);
      const updated = this.store.update(build.id, {
        status: 'interrupted',
        currentStage: 'recovery',
        currentStep: 'Computer 2 connection interrupted; automatic polling will retry',
        errors: [...build.errors, { timestamp: new Date().toISOString(), errorClass, message: error instanceof Error ? error.message : String(error) }],
      });
      this.store.appendLog(updated.id, { step: 'job-status', target: 'computer-2', tool: 'job_status', errorClass, attempt: build.retryCount + 1, repairAction: 'Reconnect to Computer 2 and poll the persisted job again', result: 'interrupted' });
      this.emit(updated, {
        category: 'repair', stage: 'recovery', severity: 'warning',
        humanMessage: 'Lost the Computer 2 connection; reconnecting to the persisted job.',
        technicalPayload: { errorClass, repairAction: 'Reconnect to Computer 2 and poll the persisted job again' },
      });
      return updated;
    }
  }

  private implementationScreenshots(build: BuildRecord, evidence: CompletionEvidence) {
    const root = resolve(build.workspace);
    const rootPrefix = `${root}${sep}`.toLowerCase();
    const allowed = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp']]);
    const shots: Array<{ label: string; dataUrl: string }> = [];
    for (const screenshot of evidence.screenshots || []) {
      if (!screenshot?.path || !screenshot?.label) continue;
      const absolute = resolve(isAbsolute(screenshot.path) ? screenshot.path : join(build.workspace, screenshot.path));
      const lower = absolute.toLowerCase();
      if (lower !== root.toLowerCase() && !lower.startsWith(rootPrefix)) continue;
      const mime = allowed.get(extname(absolute).toLowerCase());
      if (!mime || !existsSync(absolute)) continue;
      const stat = statSync(absolute);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
      shots.push({ label: screenshot.label.slice(0, 80), dataUrl: `data:${mime};base64,${readFileSync(absolute).toString('base64')}` });
    }
    return shots.slice(0, 4);
  }

  private async queueDesignRepair(build: BuildRecord, qa: DesignVisualQa) {
    const nextAttempt = (build.designQaAttempts || 0) + 1;
    const maxRepairs = Math.max(0, Number(process.env.BUILDER_DESIGN_QA_REPAIR_ROUNDS || 2) || 2);
    const qaPath = join(build.workspace, '.builder', 'design-qa.json');
    writeFileSync(qaPath, JSON.stringify(qa, null, 2), 'utf8');
    this.store.recordEvidence(build.id, { kind: 'visual-qa', summary: `Design match ${qa.score}/100. ${qa.summary}`, ref: qaPath });
    if (nextAttempt > maxRepairs) {
      const mismatch = qa.mismatches.map((item) => `${item.area}: ${item.repair}`).join('; ');
      return this.failCompletion(build, `Visual design QA remained below ${qa.threshold}/100 after ${maxRepairs} automatic repair rounds. ${mismatch || qa.summary}`, qa);
    }
    const completionPath = join(build.workspace, '.builder', 'completion.json');
    if (existsSync(completionPath)) renameSync(completionPath, join(build.workspace, '.builder', `completion.pre-design-qa-${Date.now()}.json`));
    const repairing = this.store.update(build.id, {
      status: 'repairing',
      currentStage: 'visual-qa',
      currentStep: `Repairing visual design mismatches from visual QA round ${nextAttempt}`,
      designQa: qa,
      designQaAttempts: nextAttempt,
      finishedAt: null,
    });
    this.emit(repairing, {
      category: 'design-repair', stage: 'visual-qa', severity: 'warning',
      humanMessage: `Design match is ${qa.score}/100. Autonomous visual repair round ${nextAttempt} is starting.`,
      technicalPayload: { score: qa.score, threshold: qa.threshold, mismatches: qa.mismatches },
    });
    return await this.rerunVerification(build.id, `Visual design repair round ${nextAttempt} queued`, 'visual-qa');
  }

  private async runDesignQaGate(build: BuildRecord, evidence: CompletionEvidence) {
    if (!build.intakeId || !this.intakeStore || !this.designQaConfigured()) return null;
    const design = this.intakeStore.currentDesignContract(build.intakeId);
    if (!design) return null;
    const screenshots = this.implementationScreenshots(build, evidence);
    const labels = new Set(screenshots.map((shot) => shot.label.toLowerCase()));
    let qa: DesignVisualQa;
    if (screenshots.length < 2 || !labels.has('desktop') || !labels.has('mobile')) {
      qa = {
        id: `design-qa-missing-${Date.now()}`,
        intakeId: build.intakeId,
        projectId: build.projectId,
        designId: design.id,
        model: design.model,
        score: 0,
        threshold: Number(process.env.BUILDER_DESIGN_QA_THRESHOLD || 98),
        passed: false,
        summary: 'Required desktop and mobile implementation screenshots were not supplied for visual verification.',
        strengths: [],
        mismatches: [{ area: 'Visual QA evidence', severity: 'critical', expected: 'Desktop 1440x1000 and mobile 390x844 screenshots inside the workspace', observed: `Received ${screenshots.length} usable screenshot(s)`, repair: 'Capture both required screenshots after the app is running and include their workspace paths in completion.json' }],
        screenshots: screenshots.map((shot) => shot.label),
        createdAt: new Date().toISOString(),
      };
    } else {
      try {
        qa = await this.designReviewer(build.intakeId, screenshots, Number(process.env.BUILDER_DESIGN_QA_THRESHOLD || 98));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const updated = this.store.update(build.id, { warnings: [...build.warnings, `Visual QA temporarily unavailable: ${message}`] });
        this.store.recordEvidence(build.id, { kind: 'visual-qa', summary: `Visual QA service degraded without blocking functional completion: ${message}` });
        this.emit(updated, { category: 'design-qa-degraded', stage: 'verification', severity: 'warning', humanMessage: 'Visual AI review was temporarily unavailable; functional production gates remain authoritative.', technicalPayload: { message } });
        return null;
      }
    }
    this.store.update(build.id, { designQa: qa });
    if (!qa.passed) return await this.queueDesignRepair(build, qa);
    this.store.recordEvidence(build.id, { kind: 'visual-qa', summary: `Visual design match passed at ${qa.score}/100`, ref: qa.id });
    return null;
  }

  private async completeFromEvidence(build: BuildRecord, remote: Record<string, unknown>, retryCount: number, attempt: number) {
    const result = await this.caller('job_result', { job_id: build.jobId, full: true });
    const completionPath = join(build.workspace, '.builder', 'completion.json');
    let evidence: CompletionEvidence;
    try { evidence = JSON.parse(readFileSync(completionPath, 'utf8')) as CompletionEvidence; }
    catch (error) {
      const workerPid = this.readWorkerPid(build.workspace);
      if (workerPid && this.processIsAlive(workerPid)) {
        const running = this.store.update(build.id, {
          status: 'running',
          currentStage: 'execution',
          currentStep: `Detached Computer 2 worker ${workerPid} is implementing and verifying`,
          retryCount,
          checkpoints: build.checkpoints.some((checkpoint) => checkpoint.workerPid === workerPid)
            ? build.checkpoints
            : [...build.checkpoints, { timestamp: new Date().toISOString(), workerPid, launchJobId: build.jobId }],
        });
        if (build.status !== 'running' || !build.currentStep.includes('Detached')) {
          this.store.appendLog(running.id, { step: 'worker', target: 'computer-2', tool: 'detached-worker', attempt, result: { status: 'running', workerPid } });
        }
        return running;
      }
      const launchedAt = new Date(build.startedAt || build.createdAt).getTime();
      if (Date.now() - launchedAt < 60_000) {
        return this.store.update(build.id, {
          status: 'running',
          currentStage: 'execution',
          currentStep: 'Scheduled Computer 2 worker is starting',
          retryCount,
        });
      }
      return this.failCompletion(build, `Completion evidence is unreadable: ${error instanceof Error ? error.message : String(error)}`, result);
    }
    const validation = validateCompletionEvidence(evidence, build.request.target);
    if (!validation.ok) return this.failCompletion(build, validation.reason, result);
    if (!targetIsWebRuntime(build.request.target)) {
      const workspaceRoot = resolve(build.workspace);
      const artifactPaths = (evidence.artifacts || []).filter((artifact) => artifact.verified !== false && artifact.path?.trim()).map((artifact) => {
        const candidate = resolve(isAbsolute(artifact.path) ? artifact.path : join(build.workspace, artifact.path));
        const insideWorkspace = candidate.toLowerCase().startsWith(`${workspaceRoot.toLowerCase()}${sep}`);
        return insideWorkspace && existsSync(candidate) && statSync(candidate).isFile() ? candidate : '';
      }).filter(Boolean);
      if (!artifactPaths.length) return this.failCompletion(build, `The requested ${targetLabel(build.request.target)} artifact was not found inside the project workspace.`, result);
      for (const group of requiredArtifactExtensionGroups(build.request.target)) {
        if (!artifactPaths.some((artifactPath) => group.includes(extname(artifactPath).toLowerCase()))) return this.failCompletion(build, `The ${targetLabel(build.request.target)} completion is missing a required ${group.join(' or ')} artifact.`, result);
      }
    }
    const repairAttempts = evidence.repairs?.length || 0;
    const visualRepair = await this.runDesignQaGate(build, evidence);
    if (visualRepair) return visualRepair;
    await this.terminateWorker(build, 'completion-worker-cleanup');
    const completed = this.store.update(build.id, {
      status: 'complete',
      currentStage: 'complete',
      currentStep: targetIsWebRuntime(build.request.target) ? 'Production gate passed and local application is running' : `Production gate passed and ${targetLabel(build.request.target)} artifact is verified`,
      retryCount,
      repairAttempts,
      finishedAt: new Date().toISOString(),
      verification: evidence.verification || [],
      result: evidence.result ?? result,
      appUrl: evidence.appUrl || '',
      checkpoints: [...build.checkpoints, { timestamp: new Date().toISOString(), remote, evidencePath: completionPath }],
    });
    for (const repair of evidence.repairs || []) this.store.appendLog(completed.id, { step: 'repair', target: 'computer-2', attempt, errorClass: String(repair.errorClass || 'unknown'), repairAction: String(repair.repairAction || ''), result: repair.result });
    for (const repair of evidence.repairs || []) this.emit(completed, {
      category: 'repair', stage: 'verification', severity: 'warning', humanMessage: String(repair.repairAction || 'Repaired a recoverable verification failure.'),
      technicalPayload: repair,
    });
    if (this.intakeStore?.getProject(completed.projectId)) {
      this.intakeStore.rememberSemanticSegment(completed.projectId, {
        kind: 'build',
        title: `Production build completed${completed.designQa ? ` · design ${completed.designQa.score}/100` : ''}`,
        content: `Application: ${completed.appUrl || 'local runtime'}\nVerification gates: ${completed.verification.map((check) => `${check.name}:${check.status}`).join(', ')}${completed.designQa ? `\nVisual QA: ${completed.designQa.score}/${completed.designQa.threshold} ${completed.designQa.summary}` : ''}`,
        tags: ['build', 'complete', 'production', ...(completed.designQa ? ['visual-qa'] : [])],
        sourceRef: completed.id,
        confidence: 1,
      });
    }
    this.store.appendLog(completed.id, { step: 'completion-gate', target: 'computer-2', tool: 'job_result', attempt, result: { status: 'complete', appUrl: completed.appUrl, verification: completed.verification } });
    this.emit(completed, { category: 'verification-complete', stage: 'complete', severity: 'success', humanMessage: targetIsWebRuntime(build.request.target) ? 'Production verification passed and the local application is running.' : `Production verification passed and the ${targetLabel(build.request.target)} artifact is verified.`, technicalPayload: { appUrl: completed.appUrl, artifacts: evidence.artifacts, verification: completed.verification } });
    this.updateProjectState(completed, 'complete');
    return completed;
  }

  private failCompletion(build: BuildRecord, message: string, result: unknown) {
    const errorClass = classifyBuildError(message);
    const failed = this.store.update(build.id, {
      status: 'failed', currentStage: 'verification', currentStep: 'Production completion gate failed', finishedAt: new Date().toISOString(),
      errors: [...build.errors, { timestamp: new Date().toISOString(), errorClass, message }], result,
    });
    if (this.intakeStore?.getProject(failed.projectId)) {
      this.intakeStore.rememberSemanticSegment(failed.projectId, {
        kind: 'verification',
        title: `Production gate failed · ${errorClass}`,
        content: `${message}\nStage: ${failed.currentStage}\nStep: ${failed.currentStep}`,
        tags: ['build', 'failed', 'verification', errorClass],
        sourceRef: failed.id,
        confidence: 1,
      });
    }
    this.store.appendLog(failed.id, { step: 'completion-gate', target: 'computer-2', errorClass, result: 'failed', message });
    this.emit(failed, { category: 'blocked', stage: 'verification', severity: 'error', humanMessage: 'The production completion gate failed.', technicalPayload: { errorClass, message } });
    this.updateProjectState(failed, 'failed');
    return failed;
  }

  private windmillCheckpoint(build: BuildRecord) {
    for (let index = build.checkpoints.length - 1; index >= 0; index -= 1) {
      const checkpoint = build.checkpoints[index];
      if (typeof checkpoint.windmillJobId === 'string' && checkpoint.windmillJobId) return checkpoint;
    }
    return null;
  }

  private windmillScriptPath(build: BuildRecord) {
    return `u/admin/autonomous_builder_${build.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  }

  private async startWindmillOrchestration(build: BuildRecord) {
    if (!this.windmillConfigured()) {
      const message = 'Windmill orchestration is requested but the local Builder-scoped Windmill MCP is not configured.';
      const updated = this.store.update(build.id, {
        errors: [...build.errors, { timestamp: new Date().toISOString(), errorClass: 'configuration', message }],
      });
      this.store.appendLog(updated.id, { step: 'windmill', target: 'windmill', errorClass: 'configuration', result: 'degraded', message });
      return updated;
    }

    const scriptPath = this.windmillScriptPath(build);
    const builderPort = Number(process.env.BUILDER_PORT || 3107) || 3107;
    const statusUrl = `http://host.docker.internal:${builderPort}/api/builds/status?build_id=${encodeURIComponent(build.id)}`;
    const content = `export async function main() {
  const statusUrl = ${JSON.stringify(statusUrl)};
  const terminal = new Set(['complete', 'failed', 'blocked', 'cancelled']);
  const deadline = Date.now() + 105 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(statusUrl, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const build = await response.json();
        if (terminal.has(String(build.status || ''))) {
          return { buildId: ${JSON.stringify(build.id)}, status: build.status, appUrl: build.appUrl || null, finishedAt: build.finishedAt || null };
        }
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('Autonomous Builder Windmill orchestration timed out before the build became terminal.');
}`;

    try {
      try { await this.windmillCaller('deleteScriptByPath', { path: scriptPath }); } catch {}
      await this.windmillCaller('createScript', {
        path: scriptPath,
        summary: `Autonomous Builder orchestration for ${build.id}`,
        description: 'Durable Windmill watcher for a Builder execution that explicitly requires Windmill.',
        content,
        language: 'nativets',
        kind: 'script',
        deployment_message: `Autonomous Builder ${build.id}`,
      });
      const launched = await this.windmillCaller('runScriptByPath', { path: scriptPath });
      const windmillJobId = typeof launched === 'string' ? launched : pickId(launched, ['id', 'job_id', 'jobId']);
      if (!windmillJobId) throw new Error('Windmill did not return a durable job id');
      const updated = this.store.update(build.id, {
        checkpoints: [...build.checkpoints, { timestamp: new Date().toISOString(), windmillJobId, windmillScriptPath: scriptPath, windmillStatus: 'running' }],
      });
      this.store.appendLog(updated.id, { step: 'windmill', target: 'windmill', tool: 'runScriptByPath', result: { jobId: windmillJobId, scriptPath, status: 'running' } });
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = classifyBuildError(error);
      const updated = this.store.update(build.id, { errors: [...build.errors, { timestamp: new Date().toISOString(), errorClass, message }] });
      this.store.appendLog(updated.id, { step: 'windmill', target: 'windmill', errorClass, repairAction: 'Keep the Computer 2 build running and retry Windmill when durable orchestration is needed', result: 'degraded', message });
      return updated;
    }
  }

  private async refreshWindmill(build: BuildRecord) {
    const checkpoint = this.windmillCheckpoint(build);
    const windmillJobId = checkpoint?.windmillJobId;
    if (typeof windmillJobId !== 'string' || !windmillJobId || !this.windmillConfigured()) return build;
    try {
      const job = recordOf(await this.windmillCaller('getJob', { id: windmillJobId, no_logs: true, no_code: true }));
      const status = job.success === true ? 'succeeded' : job.success === false ? 'failed' : job.running === true ? 'running' : 'queued';
      if (checkpoint.windmillStatus !== status) {
        const updated = this.store.update(build.id, {
          checkpoints: [...build.checkpoints, { timestamp: new Date().toISOString(), windmillJobId, windmillScriptPath: checkpoint.windmillScriptPath, windmillStatus: status }],
        });
        this.store.appendLog(updated.id, { step: 'windmill-status', target: 'windmill', tool: 'getJob', result: { jobId: windmillJobId, status } });
        return updated;
      }
    } catch (error) {
      this.store.appendLog(build.id, { step: 'windmill-status', target: 'windmill', tool: 'getJob', errorClass: classifyBuildError(error), result: 'degraded', message: error instanceof Error ? error.message : String(error) });
    }
    return build;
  }

  private readWorkerPid(workspace: string) {
    try {
      const value = Number(readFileSync(join(workspace, '.builder', 'worker.pid'), 'utf8').trim());
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch { return null; }
  }

  private processIsAlive(pid: number) {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  private async terminateWorker(build: BuildRecord, step: string) {
    const workerPid = this.readWorkerPid(build.workspace);
    if (!workerPid) return;
    const workspace = build.workspace.replaceAll("'", "''");
    try {
      await this.caller('computer_batch', {
        cwd: build.workspace,
        stop_on_error: false,
        actions: [
          { type: 'command', command: `taskkill /PID ${workerPid} /T /F`, cwd: build.workspace, timeout_ms: 30_000 },
          {
            type: 'command',
            command: `$builderWorkspace='${workspace}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($builderWorkspace) -and $_.Name -in @('powershell.exe','pwsh.exe','node.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
            cwd: build.workspace,
            timeout_ms: 30_000,
          },
        ],
      });
      this.store.appendLog(build.id, { step, target: 'computer-2', tool: 'computer_batch', result: { workerPid, processTree: 'terminated' } });
    } catch (error) {
      this.store.appendLog(build.id, { step, target: 'computer-2', tool: 'computer_batch', result: { workerPid, processTree: 'already-exited-or-unreachable' }, message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async recordRemoteFailure(build: BuildRecord, remote: Record<string, unknown>) {
    const result = recordOf(await this.caller('job_result', { job_id: build.jobId, full: true }));
    const message = String(result.error || remote.error || 'Computer 2 execution job failed');
    const errorClass = classifyBuildError(message);
    const failed = this.store.update(build.id, { errors: [...build.errors, { timestamp: new Date().toISOString(), errorClass, message }], result });
    this.store.appendLog(failed.id, { step: 'job-result', target: 'computer-2', tool: 'job_result', errorClass, attempt: build.retryCount + 1, result: 'failed', message });
    this.updateProjectState(failed, 'failed');
    return failed;
  }

  async cancel(buildId: string) {
    const build = this.store.get(buildId);
    if (!build) throw new Error(`Unknown build: ${buildId}`);
    if (build.jobId) await this.caller('job_cancel', { job_id: build.jobId });
    const windmill = this.windmillCheckpoint(build);
    if (typeof windmill?.windmillJobId === 'string' && windmill.windmillJobId) {
      try { await this.windmillCancel(windmill.windmillJobId, `Builder build ${build.id} was cancelled`); }
      catch (error) { this.store.appendLog(build.id, { step: 'windmill-cancel', target: 'windmill', errorClass: classifyBuildError(error), result: 'degraded', message: error instanceof Error ? error.message : String(error) }); }
    }
    await this.terminateWorker(build, 'cancel-worker');
    const cancelled = this.store.update(build.id, { status: 'cancelled', currentStage: 'cancelled', currentStep: 'Cancelled by user', finishedAt: new Date().toISOString() });
    this.store.appendLog(cancelled.id, { step: 'cancel', target: 'computer-2', tool: 'job_cancel', result: 'cancelled' });
    this.emit(cancelled, { category: 'cancelled', stage: 'cancelled', severity: 'warning', humanMessage: 'Build cancelled by the user.' });
    this.updateProjectState(cancelled, 'cancelled');
    return cancelled;
  }

  async rerunVerification(buildId: string, currentStep = 'Production verification rerun queued', currentStage = 'verification') {
    const build = this.store.get(buildId);
    if (!build) throw new Error(`Unknown build: ${buildId}`);
    const scriptPath = join(build.workspace, '.builder', 'launch-build.ps1');
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath.replaceAll('"', '`"')}"`;
    const job = await this.caller('job_submit', {
      tool: 'computer_batch',
      arguments: {
        cwd: build.workspace,
        stop_on_error: true,
        actions: [{ type: 'command', command, cwd: build.workspace, timeout_ms: 600_000 }],
      },
    });
    const jobId = pickId(job, ['job_id', 'jobId', 'id']);
    if (!jobId) throw new Error('Computer 2 did not return a verification job id');
    const rerun = this.store.update(build.id, {
      jobId,
      status: 'queued',
      currentStage,
      currentStep,
      verification: build.verification.map((check) => ({ ...check, status: 'pending' })),
      finishedAt: null,
    });
    this.store.appendLog(rerun.id, { step: 'verification-rerun', target: 'computer-2', tool: 'job_submit', result: { jobId, status: 'queued' } });
    this.updateProjectState(rerun, 'building');
    return rerun;
  }

  async resumeInterrupted() {
    const response = recordOf(await this.caller('job_resume', {}));
    const resumedCount = Number(response.resumed_count ?? 0) || 0;
    const builds = this.store.unfinished();
    const refreshed: BuildRecord[] = [];
    for (const build of builds) if (build.jobId) refreshed.push(await this.refresh(build.id));
    return { resumedCount, builds: refreshed };
  }
}

const globalService = globalThis as typeof globalThis & { __autonomousBuildService?: BuildService };

export function getBuildService() {
  if (!globalService.__autonomousBuildService) {
    globalService.__autonomousBuildService = new BuildService({ store: getBuildStore(), intakeStore: getIntakeStore(), callComputer2: defaultComputer2Caller, projectsRoot: defaultProjectsRoot() });
  }
  return globalService.__autonomousBuildService;
}
