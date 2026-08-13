import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BuildAnalysis, BuildRequest, ExecutionTarget } from './builder';

export type BuildStatus = 'planning' | 'queued' | 'running' | 'paused' | 'interrupted' | 'repairing' | 'blocked' | 'failed' | 'cancelled' | 'complete';

export type VerificationCheck = {
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  detail?: string;
};

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
    const updated: BuildRecord = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
    this.write(updated);
    return updated;
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
  }
  return globalStore.__autonomousBuildStore;
}

export function defaultProjectsRoot() {
  return process.env.BUILDER_PROJECTS_ROOT?.trim() || join(homedir(), 'Autonomous-Builder-Projects');
}
