import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { redactSecrets } from '../build-store.ts';
import type {
  ApprovalBuildConfiguration,
  ApprovalContract,
  BriefDecision,
  BuildBrief,
  BuildBriefContent,
  EvidenceRecord,
  ProjectEvent,
  ProjectState,
  SourceManifestItem,
} from './types';

export type ProjectRecord = {
  id: string;
  name: string;
  objective: string;
  workspace: string;
  state: ProjectState;
  currentIntakeId: string;
  activeBuildId: string;
  createdAt: string;
  updatedAt: string;
};

export type IntakeRecord = {
  id: string;
  projectId: string;
  status: 'draft' | 'queued' | 'extracting' | 'rendering' | 'inspecting' | 'synthesizing' | 'awaiting-resolution' | 'awaiting-approval' | 'approved' | 'invalidated' | 'blocked' | 'failed';
  planId: string;
  jobId: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredSourceManifestItem = SourceManifestItem & { intakeId: string; localPath: string };

type ProjectEventInput = Omit<ProjectEvent, 'sequence' | 'eventId' | 'projectId' | 'timestamp'> & {
  eventId?: string;
  timestamp?: string;
};

function parse<T>(value: string) {
  return JSON.parse(value) as T;
}

export class IntakeStore {
  private database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS intakes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        job_id TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS intakes_project_idx ON intakes(project_id, updated_at);
      CREATE TABLE IF NOT EXISTS source_revisions (
        revision_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        intake_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        availability TEXT NOT NULL,
        local_path TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(source_id, revision)
      );
      CREATE INDEX IF NOT EXISTS source_revisions_intake_idx ON source_revisions(intake_id, source_id, revision);
      CREATE TABLE IF NOT EXISTS evidence (
        evidence_id TEXT PRIMARY KEY,
        intake_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        page INTEGER,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS evidence_source_idx ON evidence(intake_id, source_id, page);
      CREATE TABLE IF NOT EXISTS brief_versions (
        id TEXT PRIMARY KEY,
        intake_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(intake_id, version)
      );
      CREATE TABLE IF NOT EXISTS brief_decisions (
        decision_id TEXT PRIMARY KEY,
        brief_id TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS brief_decisions_brief_idx ON brief_decisions(brief_id);
      CREATE TABLE IF NOT EXISTS approval_contracts (
        approval_id TEXT PRIMARY KEY,
        intake_id TEXT NOT NULL,
        brief_version_id TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS approval_intake_idx ON approval_contracts(intake_id, approved_at);
      CREATE TABLE IF NOT EXISTS project_events (
        event_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        event_json TEXT NOT NULL,
        UNIQUE(project_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS project_events_replay_idx ON project_events(project_id, sequence);
    `);
  }

  close() {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  createProject(input: { name: string; objective: string; workspace: string }): ProjectRecord {
    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id: `project-${randomUUID()}`,
      name: input.name,
      objective: input.objective,
      workspace: input.workspace,
      state: 'draft',
      currentIntakeId: '',
      activeBuildId: '',
      createdAt: now,
      updatedAt: now,
    };
    this.writeProject(project);
    return project;
  }

  getProject(projectId: string) {
    const row = this.database.prepare('SELECT record_json FROM projects WHERE id = ?').get(projectId) as { record_json: string } | undefined;
    return row ? parse<ProjectRecord>(row.record_json) : null;
  }

  allProjects() {
    const rows = this.database.prepare('SELECT record_json FROM projects ORDER BY updated_at DESC').all() as Array<{ record_json: string }>;
    return rows.map((row) => parse<ProjectRecord>(row.record_json));
  }

  updateProject(projectId: string, patch: Partial<ProjectRecord>) {
    const current = this.getProject(projectId);
    if (!current) throw new Error(`Unknown project: ${projectId}`);
    const updated = { ...current, ...patch, id: projectId, updatedAt: new Date().toISOString() };
    this.writeProject(updated);
    return updated;
  }

  private writeProject(project: ProjectRecord) {
    this.database.prepare(`INSERT INTO projects (id, state, updated_at, record_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at, record_json=excluded.record_json`)
      .run(project.id, project.state, project.updatedAt, JSON.stringify(project));
  }

  createIntake(projectId: string): IntakeRecord {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const now = new Date().toISOString();
    const intake: IntakeRecord = { id: `intake-${randomUUID()}`, projectId, status: 'draft', planId: '', jobId: '', createdAt: now, updatedAt: now };
    this.writeIntake(intake);
    this.updateProject(projectId, { currentIntakeId: intake.id, state: 'draft' });
    return intake;
  }

  getIntake(intakeId: string) {
    const row = this.database.prepare('SELECT record_json FROM intakes WHERE id = ?').get(intakeId) as { record_json: string } | undefined;
    return row ? parse<IntakeRecord>(row.record_json) : null;
  }

  updateIntake(intakeId: string, patch: Partial<IntakeRecord>) {
    const current = this.getIntake(intakeId);
    if (!current) throw new Error(`Unknown intake: ${intakeId}`);
    const updated = { ...current, ...patch, id: intakeId, projectId: current.projectId, updatedAt: new Date().toISOString() };
    this.writeIntake(updated);
    return updated;
  }

  private writeIntake(intake: IntakeRecord) {
    this.database.prepare(`INSERT INTO intakes (id, project_id, status, job_id, updated_at, record_json) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, job_id=excluded.job_id, updated_at=excluded.updated_at, record_json=excluded.record_json`)
      .run(intake.id, intake.projectId, intake.status, intake.jobId, intake.updatedAt, JSON.stringify(intake));
  }

  addSourceRevision(intakeId: string, input: {
    sourceId?: string;
    contentHash: string;
    mimeType: string;
    originalFilename: string;
    normalizedFilename: string;
    size: number;
    localPath: string;
  }): StoredSourceManifestItem {
    if (!this.getIntake(intakeId)) throw new Error(`Unknown intake: ${intakeId}`);
    const sourceId = input.sourceId || `source-${randomUUID()}`;
    const previousRow = this.database.prepare('SELECT record_json FROM source_revisions WHERE source_id = ? ORDER BY revision DESC LIMIT 1')
      .get(sourceId) as { record_json: string } | undefined;
    const previous = previousRow ? parse<StoredSourceManifestItem>(previousRow.record_json) : null;
    if (previous && previous.intakeId !== intakeId) throw new Error('Source does not belong to this intake');
    const source: StoredSourceManifestItem = {
      sourceId,
      revisionId: `revision-${randomUUID()}`,
      revision: previous ? previous.revision + 1 : 1,
      ...(previous ? { replacesRevisionId: previous.revisionId } : {}),
      contentHash: input.contentHash,
      mimeType: input.mimeType,
      originalFilename: input.originalFilename,
      normalizedFilename: input.normalizedFilename,
      size: input.size,
      ingestedAt: new Date().toISOString(),
      availability: 'available',
      processingStatus: 'stored',
      intakeId,
      localPath: input.localPath,
    };
    this.database.prepare(`INSERT INTO source_revisions
      (revision_id, source_id, intake_id, revision, availability, local_path, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(source.revisionId, source.sourceId, intakeId, source.revision, source.availability, source.localPath, JSON.stringify(source));
    return source;
  }

  listSourceRevisions(intakeId: string) {
    const rows = this.database.prepare('SELECT record_json FROM source_revisions WHERE intake_id = ? ORDER BY source_id, revision').all(intakeId) as Array<{ record_json: string }>;
    return rows.map((row) => parse<StoredSourceManifestItem>(row.record_json));
  }

  updateSourceRevision(revisionId: string, patch: Partial<StoredSourceManifestItem>) {
    const row = this.database.prepare('SELECT record_json FROM source_revisions WHERE revision_id = ?').get(revisionId) as { record_json: string } | undefined;
    if (!row) throw new Error(`Unknown source revision: ${revisionId}`);
    const current = parse<StoredSourceManifestItem>(row.record_json);
    const updated = { ...current, ...patch, revisionId: current.revisionId, sourceId: current.sourceId, intakeId: current.intakeId, localPath: current.localPath };
    this.database.prepare('UPDATE source_revisions SET availability = ?, local_path = ?, record_json = ? WHERE revision_id = ?')
      .run(updated.availability, updated.localPath, JSON.stringify(updated), revisionId);
    return updated;
  }

  currentSources(intakeId: string) {
    const rows = this.database.prepare(`SELECT s.record_json FROM source_revisions s
      INNER JOIN (SELECT source_id, MAX(revision) AS revision FROM source_revisions WHERE intake_id = ? GROUP BY source_id) latest
      ON latest.source_id = s.source_id AND latest.revision = s.revision ORDER BY s.source_id`).all(intakeId) as Array<{ record_json: string }>;
    return rows.map((row) => parse<StoredSourceManifestItem>(row.record_json));
  }

  tombstoneSource(sourceId: string) {
    const rows = this.database.prepare('SELECT record_json FROM source_revisions WHERE source_id = ? ORDER BY revision').all(sourceId) as Array<{ record_json: string }>;
    if (rows.length === 0) throw new Error(`Unknown source: ${sourceId}`);
    let latest: StoredSourceManifestItem | null = null;
    const update = this.database.prepare('UPDATE source_revisions SET availability = ?, record_json = ? WHERE revision_id = ?');
    for (const row of rows) {
      const source = { ...parse<StoredSourceManifestItem>(row.record_json), availability: 'deleted' as const };
      update.run(source.availability, JSON.stringify(source), source.revisionId);
      latest = source;
    }
    return latest!;
  }

  recordEvidence(input: Omit<EvidenceRecord, 'evidenceId' | 'createdAt'>) {
    const evidence: EvidenceRecord = { ...input, evidenceId: `evidence-${randomUUID()}`, createdAt: new Date().toISOString() };
    this.database.prepare('INSERT INTO evidence (evidence_id, intake_id, source_id, revision_id, page, record_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(evidence.evidenceId, evidence.intakeId, evidence.sourceId, evidence.revisionId, evidence.page ?? null, JSON.stringify(evidence));
    return evidence;
  }

  evidenceForBriefSource(intakeId: string, sourceId: string) {
    const rows = this.database.prepare('SELECT record_json FROM evidence WHERE intake_id = ? AND source_id = ? ORDER BY page, evidence_id').all(intakeId, sourceId) as Array<{ record_json: string }>;
    return rows.map((row) => parse<EvidenceRecord>(row.record_json));
  }

  evidenceForIntake(intakeId: string) {
    const rows = this.database.prepare('SELECT record_json FROM evidence WHERE intake_id = ? ORDER BY source_id, page, evidence_id').all(intakeId) as Array<{ record_json: string }>;
    return rows.map((row) => parse<EvidenceRecord>(row.record_json));
  }

  createBriefVersion(intakeId: string, content: BuildBriefContent, visualCoverage: BuildBrief['visualCoverage']) {
    const row = this.database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM brief_versions WHERE intake_id = ?').get(intakeId) as { version: number };
    const createdAt = new Date().toISOString();
    const brief: BuildBrief = { id: `brief-${randomUUID()}`, intakeId, version: Number(row.version) + 1, content, visualCoverage, createdAt };
    this.database.prepare('INSERT INTO brief_versions (id, intake_id, version, created_at, record_json) VALUES (?, ?, ?, ?, ?)')
      .run(brief.id, intakeId, brief.version, createdAt, JSON.stringify(brief));
    return brief;
  }

  currentBrief(intakeId: string) {
    const row = this.database.prepare('SELECT record_json FROM brief_versions WHERE intake_id = ? ORDER BY version DESC LIMIT 1').get(intakeId) as { record_json: string } | undefined;
    return row ? parse<BuildBrief>(row.record_json) : null;
  }

  addDecision(briefId: string, input: { question: string; required: boolean }) {
    const decision: BriefDecision = { decisionId: `decision-${randomUUID()}`, question: input.question, resolution: '', required: input.required };
    this.database.prepare('INSERT INTO brief_decisions (decision_id, brief_id, record_json) VALUES (?, ?, ?)')
      .run(decision.decisionId, briefId, JSON.stringify(decision));
    return decision;
  }

  resolveDecision(decisionId: string, resolution: string) {
    const row = this.database.prepare('SELECT record_json FROM brief_decisions WHERE decision_id = ?').get(decisionId) as { record_json: string } | undefined;
    if (!row) throw new Error(`Unknown decision: ${decisionId}`);
    const decision = { ...parse<BriefDecision>(row.record_json), resolution, resolvedAt: new Date().toISOString() };
    this.database.prepare('UPDATE brief_decisions SET record_json = ? WHERE decision_id = ?').run(JSON.stringify(decision), decisionId);
    return decision;
  }

  decisionsForBrief(briefId: string) {
    const rows = this.database.prepare('SELECT record_json FROM brief_decisions WHERE brief_id = ? ORDER BY decision_id').all(briefId) as Array<{ record_json: string }>;
    return rows.map((row) => parse<BriefDecision>(row.record_json));
  }

  approve(input: { projectId: string; intakeId: string; briefVersionId: string; hash: string; buildConfiguration: ApprovalBuildConfiguration }) {
    const contract: ApprovalContract = {
      approvalId: `approval-${randomUUID()}`,
      projectId: input.projectId,
      intakeId: input.intakeId,
      briefVersionId: input.briefVersionId,
      hash: input.hash,
      approvedAt: new Date().toISOString(),
      buildConfiguration: input.buildConfiguration,
    };
    this.database.prepare('INSERT INTO approval_contracts (approval_id, intake_id, brief_version_id, approved_at, record_json) VALUES (?, ?, ?, ?, ?)')
      .run(contract.approvalId, contract.intakeId, contract.briefVersionId, contract.approvedAt, JSON.stringify(contract));
    this.updateIntake(input.intakeId, { status: 'approved' });
    this.updateProject(input.projectId, { state: 'approved' });
    return contract;
  }

  currentApproval(intakeId: string) {
    const row = this.database.prepare('SELECT record_json FROM approval_contracts WHERE intake_id = ? ORDER BY approved_at DESC LIMIT 1').get(intakeId) as { record_json: string } | undefined;
    return row ? parse<ApprovalContract>(row.record_json) : null;
  }

  appendEvent(projectId: string, input: ProjectEventInput) {
    if (!this.getProject(projectId)) throw new Error(`Unknown project: ${projectId}`);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM project_events WHERE project_id = ?').get(projectId) as { sequence: number };
      const event = redactSecrets({
        ...input,
        projectId,
        sequence: Number(row.sequence) + 1,
        eventId: input.eventId || `event-${randomUUID()}`,
        timestamp: input.timestamp || new Date().toISOString(),
      }) as ProjectEvent;
      this.database.prepare('INSERT INTO project_events (event_id, project_id, sequence, created_at, event_json) VALUES (?, ?, ?, ?, ?)')
        .run(event.eventId, projectId, event.sequence, event.timestamp, JSON.stringify(event));
      this.database.exec('COMMIT');
      return event;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  eventsAfter(projectId: string, sequence: number, limit = 500) {
    const rows = this.database.prepare('SELECT event_json FROM project_events WHERE project_id = ? AND sequence > ? ORDER BY sequence LIMIT ?')
      .all(projectId, sequence, limit) as Array<{ event_json: string }>;
    return rows.map((row) => parse<ProjectEvent>(row.event_json));
  }

  eventSequence(projectId: string, eventId: string) {
    const row = this.database.prepare('SELECT sequence FROM project_events WHERE project_id = ? AND event_id = ?').get(projectId, eventId) as { sequence: number } | undefined;
    return row ? Number(row.sequence) : null;
  }
}

const globalIntake = globalThis as typeof globalThis & { __autonomousIntakeStore?: IntakeStore };

export function getIntakeStore() {
  if (!globalIntake.__autonomousIntakeStore) {
    const databasePath = process.env.BUILDER_STATE_DB?.trim() || join(process.cwd(), '.builder', 'state.db');
    globalIntake.__autonomousIntakeStore = new IntakeStore(databasePath);
  }
  return globalIntake.__autonomousIntakeStore;
}
