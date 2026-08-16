import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BuildAnalysis, BuildRequest, ExecutionTarget } from './builder';
import type { DesignVisualQa } from './design/types';

export type BuildStatus = 'planning' | 'queued' | 'running' | 'paused' | 'interrupted' | 'repairing' | 'blocked' | 'failed' | 'cancelled' | 'complete';

export type VerificationCheck = {
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  detail?: string;
};

export type AgentControlState = {
  objective: string;
  currentGate: string;
  todos: string[];
  owner: string;
  leaseExpiresAt: string | null;
  evidence: Array<{ timestamp: string; kind: string; summary: string; ref?: string }>;
  quotas: { maxRepairAttempts: number; maxEscalations: number };
  escalationCount: number;
  updatedAt: string;
};

function defaultControlState(input: { objective?: string; currentGate?: string; currentStep?: string; updatedAt?: string }): AgentControlState {
  const now = input.updatedAt || new Date().toISOString();
  return {
    objective: input.objective || '', currentGate: input.currentGate || 'analysis', todos: input.currentStep ? [input.currentStep] : [],
    owner: '', leaseExpiresAt: null, evidence: [], quotas: { maxRepairAttempts: 8, maxEscalations: 4 }, escalationCount: 0, updatedAt: now,
  };
}
export type BuildRecord = {
  id: string;
  projectId: string;
  planId: string;
  jobId: string;
  requestedGoal: string;
  request: BuildRequest;
  analysis: BuildAnalysis | Record<string, unknown>;
  status: BuildStatus;
  currentStage: string;
  currentStep: string;
  executionTarget: ExecutionTarget;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
  retryCount: number;
  repairAttempts: number;
  errors: Array<Record<string, unknown>>;
  warnings: string[];
  checkpoints: Array<Record<string, unknown>>;
  workspace: string;
  verification: VerificationCheck[];
  result: unknown;
  appUrl: string;
  intakeId?: string;
  briefVersionId?: string;
  approvalHash?: string;
  workerEventOffset?: number;
  control?: AgentControlState;
  designQa?: DesignVisualQa;
  designQaAttempts?: number;
};

export type BuildLogEvent = {
  timestamp?: string;
  buildId?: string;
  planId?: string;
  jobId?: string;
  step?: string;
  target?: ExecutionTarget | string;
  tool?: string;
  attempt?: number;
  errorClass?: string;
  repairAction?: string;
  result?: unknown;
  message?: string;
};

const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[-_]?key|service[-_]?key/i;

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+\/=:-]+/gi, 'Bearer [REDACTED]')
      .replace(/((?:authorization|cookie|password|secret|token|api[-_]?key|service[-_]?key)\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSecrets(entry)]));
  }
  return value;
}

function parseBuildRecord(json: string): BuildRecord {
  const record = JSON.parse(json) as BuildRecord;
  record.control ||= defaultControlState({ objective: record.requestedGoal, currentGate: record.currentStage, currentStep: record.currentStep, updatedAt: record.updatedAt });
  if (record.request.deployment === 'local' && (!record.request.backend || record.request.backend === 'none')) {
    const analysis = record.analysis as Record<string, unknown>;
    if (Array.isArray(analysis.ingredients)) {
      record.analysis = {
        ...analysis,
        ingredients: analysis.ingredients.map((entry) => {
          if (!entry || typeof entry !== 'object') return entry;
          const ingredient = entry as Record<string, unknown>;
          return ingredient.id === 'backend'
            ? { ...ingredient, target: 'computer-2', detail: 'No backend is required; the local build will not invoke an external service.' }
            : ingredient;
        }),
      };
    }
  }
  return record;
}


function readJsonFile<T>(filePath: string): T | null {
  try { return JSON.parse(readFileSync(filePath, 'utf8')) as T; } catch { return null; }
}

function workspaceManifestPath(workspace: string) {
  return join(workspace, '.builder', 'build-record.json');
}

function persistWorkspaceRecord(record: BuildRecord) {
  try {
    const controlDirectory = join(record.workspace, '.builder');
    if (!existsSync(join(controlDirectory, 'request.md'))) return;
    mkdirSync(controlDirectory, { recursive: true });
    writeFileSync(workspaceManifestPath(record.workspace), JSON.stringify(record, null, 2), 'utf8');
  } catch {
    // The SQLite record remains authoritative. Workspace mirroring is recovery insurance only.
  }
}

function legacyWorkspaceRecord(workspace: string): BuildRecord | null {
  const control = join(workspace, '.builder');
  const handoffPath = join(control, 'chatgpt-handoff.json');
  if (!existsSync(handoffPath)) return null;
  const handoff = readJsonFile<Record<string, unknown>>(handoffPath);
  const id = typeof handoff?.buildId === 'string' ? handoff.buildId : '';
  if (!id.startsWith('build-')) return null;

  const completionPath = join(control, 'completion.json');
  const completion = existsSync(completionPath) ? readJsonFile<Record<string, unknown>>(completionPath) : null;
  const heartbeat = readJsonFile<Record<string, unknown>>(join(control, 'worker-heartbeat.json'));
  const prompt = existsSync(join(control, 'request.md')) ? readFileSync(join(control, 'request.md'), 'utf8') : '';
  const goalMatch = prompt.match(/GOAL\r?\n([\s\S]*?)\r?\n\r?\nPROJECT NAME\r?\n/);
  const nameMatch = prompt.match(/PROJECT NAME\r?\n([^\r\n]+)/);
  const submittedAt = typeof handoff?.submittedAt === 'string' ? handoff.submittedAt : statSync(handoffPath).mtime.toISOString();
  const terminalStatus = completion?.status === 'complete' || completion?.status === 'blocked' || completion?.status === 'failed'
    ? completion.status as BuildStatus
    : 'interrupted';
  const completedAt = completion && existsSync(completionPath) ? statSync(completionPath).mtime.toISOString() : null;
  const verification = Array.isArray(completion?.verification) ? completion.verification as VerificationCheck[] : [];
  const repairs = Array.isArray(completion?.repairs) ? completion.repairs : [];
  const appUrl = typeof completion?.appUrl === 'string' ? completion.appUrl : '';
  const threadUrl = typeof handoff?.url === 'string' ? handoff.url : '';
  const heartbeatStage = typeof heartbeat?.stage === 'string' ? heartbeat.stage : 'recovery';

  return {
    id,
    projectId: `project-recovered-${id.replace(/^build-/, '').slice(0, 12)}`,
    planId: '',
    jobId: '',
    requestedGoal: goalMatch?.[1]?.trim() || '',
    request: {
      name: nameMatch?.[1]?.trim() || 'Recovered local project',
      objective: goalMatch?.[1]?.trim() || '',
      deployment: 'local',
      backend: 'none',
      workflow: 'none',
      needsWindowsHost: true,
    },
    analysis: {
      request: {
        name: nameMatch?.[1]?.trim() || 'Recovered local project',
        objective: goalMatch?.[1]?.trim() || '',
        deployment: 'local',
        backend: 'none',
        workflow: 'none',
        needsWindowsHost: true,
      },
      ingredients: [],
      steps: [],
      stage: terminalStatus === 'interrupted' ? 'running' : terminalStatus === 'complete' ? 'complete' : 'failed',
      blockingCount: 0,
      greenCount: 0,
      yellowCount: 0,
      redCount: 0,
      canContinue: true,
      recoveredFromWorkspace: true,
    },
    status: terminalStatus,
    currentStage: terminalStatus === 'interrupted' ? heartbeatStage : terminalStatus,
    currentStep: completion ? 'Recovered completion evidence from workspace' : 'Recovered interrupted ChatGPT/MCP execution from workspace',
    executionTarget: 'computer-2',
    createdAt: submittedAt,
    startedAt: submittedAt,
    updatedAt: completedAt || new Date().toISOString(),
    finishedAt: terminalStatus === 'interrupted' ? null : (completedAt || new Date().toISOString()),
    retryCount: 0,
    repairAttempts: repairs.length,
    errors: terminalStatus === 'failed' ? [{ timestamp: completedAt || new Date().toISOString(), errorClass: 'workspace-recovery', message: 'Recovered failed build evidence from the project workspace.' }] : [],
    warnings: ['Recovered from durable workspace evidence after Builder state loss or replacement.'],
    checkpoints: [{ timestamp: new Date().toISOString(), recoveredFromWorkspace: true, chatgptThreadUrl: threadUrl }],
    workspace,
    verification,
    result: completion?.result ?? null,
    appUrl,
  };
}

export function recoverWorkspaceBuilds(store: BuildStore, projectsRoot: string) {
  if (!existsSync(projectsRoot)) return [] as string[];
  const recovered: string[] = [];
  for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const workspace = join(projectsRoot, entry.name);
    const manifest = readJsonFile<BuildRecord>(workspaceManifestPath(workspace));
    const record = manifest?.id?.startsWith('build-') ? manifest : legacyWorkspaceRecord(workspace);
    if (!record || store.get(record.id)) continue;
    store.restore(record);
    recovered.push(record.id);
  }
  return recovered;
}

export class BuildStore {
  private database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS builds (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        job_id TEXT NOT NULL DEFAULT '',
        plan_id TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS builds_status_idx ON builds(status);
      CREATE INDEX IF NOT EXISTS builds_job_idx ON builds(job_id);
      CREATE TABLE IF NOT EXISTS build_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        build_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS build_logs_build_idx ON build_logs(build_id, id);
    `);
  }

  close() {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  create(input: {
    request: BuildRequest;
    analysis: BuildAnalysis | Record<string, unknown>;
    workspace: string;
    projectId?: string;
    intakeId?: string;
    briefVersionId?: string;
    approvalHash?: string;
  }): BuildRecord {
    const now = new Date().toISOString();
    const id = `build-${randomUUID()}`;
    const record: BuildRecord = {
      id,
      projectId: input.projectId || `project-${randomUUID()}`,
      planId: '',
      jobId: '',
      requestedGoal: input.request.objective || '',
      request: input.request,
      analysis: input.analysis,
      status: 'planning',
      currentStage: 'analysis',
      currentStep: 'Creating execution plan',
      executionTarget: 'computer-2',
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      finishedAt: null,
      retryCount: 0,
      repairAttempts: 0,
      errors: [],
      warnings: [],
      checkpoints: [],
      workspace: input.workspace,
      verification: [],
      result: null,
      appUrl: '',
      ...(input.intakeId ? { intakeId: input.intakeId } : {}),
      ...(input.briefVersionId ? { briefVersionId: input.briefVersionId } : {}),
      ...(input.approvalHash ? { approvalHash: input.approvalHash } : {}),
      workerEventOffset: 0,
      control: defaultControlState({ objective: input.request.objective || '', currentGate: 'analysis', currentStep: 'Creating execution plan', updatedAt: now }),
    };
    this.write(record);
    return record;
  }

  private write(record: BuildRecord) {
    this.database.prepare(`
      INSERT INTO builds (id, status, job_id, plan_id, updated_at, record_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        job_id = excluded.job_id,
        plan_id = excluded.plan_id,
        updated_at = excluded.updated_at,
        record_json = excluded.record_json
    `).run(record.id, record.status, record.jobId, record.planId, record.updatedAt, JSON.stringify(record));
    persistWorkspaceRecord(record);
  }

  restore(record: BuildRecord) {
    this.write(record);
    return record;
  }

  get(id: string): BuildRecord | null {
    const row = this.database.prepare('SELECT record_json FROM builds WHERE id = ?').get(id) as { record_json: string } | undefined;
    return row ? parseBuildRecord(row.record_json) : null;
  }

  findByJobId(jobId: string): BuildRecord | null {
    const row = this.database.prepare('SELECT record_json FROM builds WHERE job_id = ? LIMIT 1').get(jobId) as { record_json: string } | undefined;
    return row ? parseBuildRecord(row.record_json) : null;
  }

  list(limit = 50): BuildRecord[] {
    const rows = this.database.prepare('SELECT record_json FROM builds ORDER BY updated_at DESC LIMIT ?').all(limit) as Array<{ record_json: string }>;
    return rows.map((row) => parseBuildRecord(row.record_json));
  }

  unfinished(): BuildRecord[] {
    const rows = this.database.prepare("SELECT record_json FROM builds WHERE status NOT IN ('complete','failed','cancelled','blocked') ORDER BY updated_at ASC").all() as Array<{ record_json: string }>;
    return rows.map((row) => parseBuildRecord(row.record_json));
  }

  update(id: string, patch: Partial<BuildRecord>): BuildRecord {
    const current = this.get(id);
    if (!current) throw new Error(`Unknown build: ${id}`);
    const updatedAt = new Date().toISOString();
    const currentControl = current.control || defaultControlState({ objective: current.requestedGoal, currentGate: current.currentStage, currentStep: current.currentStep, updatedAt: current.updatedAt });
    const terminal = patch.status && ['complete', 'failed', 'cancelled', 'blocked'].includes(patch.status);
    const synchronizedControl: AgentControlState = patch.control || {
      ...currentControl,
      currentGate: patch.currentStage || currentControl.currentGate,
      todos: patch.currentStep ? [patch.currentStep] : currentControl.todos,
      ...(terminal ? { owner: '', leaseExpiresAt: null } : {}),
      updatedAt,
    };
    const updated: BuildRecord = { ...current, ...patch, id, updatedAt, control: synchronizedControl };
    this.write(updated);
    return updated;
  }

  claimControl(buildId: string, owner: string, leaseMs = 120_000) {
    const current = this.get(buildId);
    if (!current) throw new Error(`Unknown build: ${buildId}`);
    const control = current.control || defaultControlState({ objective: current.requestedGoal, currentGate: current.currentStage, currentStep: current.currentStep, updatedAt: current.updatedAt });
    const now = Date.now();
    if (control.owner && control.owner !== owner && control.leaseExpiresAt && Date.parse(control.leaseExpiresAt) > now) throw new Error(`Build control is leased by ${control.owner}`);
    const next = { ...control, owner, leaseExpiresAt: new Date(now + leaseMs).toISOString(), updatedAt: new Date(now).toISOString() };
    this.update(buildId, { control: next });
    return next;
  }

  releaseControl(buildId: string, owner: string) {
    const current = this.get(buildId);
    if (!current) throw new Error(`Unknown build: ${buildId}`);
    const control = current.control || defaultControlState({ objective: current.requestedGoal, currentGate: current.currentStage, currentStep: current.currentStep, updatedAt: current.updatedAt });
    if (control.owner && control.owner !== owner) return control;
    const next = { ...control, owner: '', leaseExpiresAt: null, updatedAt: new Date().toISOString() };
    this.update(buildId, { control: next });
    return next;
  }

  recordEvidence(buildId: string, evidence: { kind: string; summary: string; ref?: string }) {
    const current = this.get(buildId);
    if (!current) throw new Error(`Unknown build: ${buildId}`);
    const control = current.control || defaultControlState({ objective: current.requestedGoal, currentGate: current.currentStage, currentStep: current.currentStep, updatedAt: current.updatedAt });
    const next = { ...control, evidence: [...control.evidence, { timestamp: new Date().toISOString(), ...evidence }].slice(-200), updatedAt: new Date().toISOString() };
    this.update(buildId, { control: next });
    return next;
  }

  appendLog(buildId: string, event: BuildLogEvent): BuildLogEvent {
    const build = this.get(buildId);
    if (!build) throw new Error(`Unknown build: ${buildId}`);
    const safe = redactSecrets({
      timestamp: event.timestamp || new Date().toISOString(),
      buildId,
      planId: event.planId ?? build.planId,
      jobId: event.jobId ?? build.jobId,
      ...event,
    }) as BuildLogEvent;
    this.database.prepare('INSERT INTO build_logs (build_id, created_at, event_json) VALUES (?, ?, ?)')
      .run(buildId, safe.timestamp || new Date().toISOString(), JSON.stringify(safe));
    return safe;
  }

  logs(buildId: string, limit = 500): BuildLogEvent[] {
    const rows = this.database.prepare('SELECT event_json FROM build_logs WHERE build_id = ? ORDER BY id ASC LIMIT ?').all(buildId, limit) as Array<{ event_json: string }>;
    return rows.map((row) => JSON.parse(row.event_json) as BuildLogEvent);
  }
}

const globalStore = globalThis as typeof globalThis & { __autonomousBuildStore?: BuildStore };

export function getBuildStore() {
  if (!globalStore.__autonomousBuildStore) {
    const databasePath = process.env.BUILDER_STATE_DB?.trim() || join(process.cwd(), '.builder', 'state.db');
    globalStore.__autonomousBuildStore = new BuildStore(databasePath);
    recoverWorkspaceBuilds(globalStore.__autonomousBuildStore, defaultProjectsRoot());
  }
  return globalStore.__autonomousBuildStore;
}

export function defaultProjectsRoot() {
  return process.env.BUILDER_PROJECTS_ROOT?.trim() || homedir();
}
