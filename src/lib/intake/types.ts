import type { ExecutionTarget } from '../builder';
import type { DesignContract } from '../design/types';
import type { BuildTargetSelection } from '../target-platform.ts';

export type ProjectState =
  | 'draft'
  | 'understanding'
  | 'awaiting-approval'
  | 'approved'
  | 'building'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'complete';

export type IntakeStatus =
  | 'draft'
  | 'queued'
  | 'extracting'
  | 'rendering'
  | 'inspecting'
  | 'synthesizing'
  | 'awaiting-resolution'
  | 'awaiting-approval'
  | 'approved'
  | 'invalidated'
  | 'blocked'
  | 'failed';

export type SourceAvailability = 'available' | 'deleted';
export type SourceProcessingStatus = 'stored' | 'processing' | 'complete' | 'blocked' | 'failed';
export type SourceRole = 'reference' | 'implementation-plan';

export type SourceManifestItem = {
  sourceId: string;
  revisionId: string;
  revision: number;
  replacesRevisionId?: string;
  contentHash: string;
  mimeType: string;
  originalFilename: string;
  normalizedFilename: string;
  size: number;
  ingestedAt: string;
  availability: SourceAvailability;
  processingStatus: SourceProcessingStatus;
  role?: SourceRole;
  pageCount?: number;
  inspectedPageCount?: number;
};

export type EvidenceKind =
  | 'user-text'
  | 'native-text'
  | 'ocr-text'
  | 'page-overview'
  | 'embedded-visual'
  | 'ui'
  | 'diagram'
  | 'table'
  | 'chart'
  | 'drawing'
  | 'annotation'
  | 'layout'
  | 'other';

export type EvidenceRegion = { x: number; y: number; width: number; height: number };

export type EvidenceRecord = {
  evidenceId: string;
  intakeId: string;
  sourceId: string;
  revisionId: string;
  page?: number;
  region?: EvidenceRegion;
  kind: EvidenceKind;
  content: string;
  relationships: string[];
  confidence: number;
  processingMethod: string;
  artifactPath?: string;
  createdAt: string;
};

export type BuildInputKind = 'folder' | 'files' | 'credential' | 'text' | 'url' | 'device' | 'manual';

export type RequirementField = {
  id: string;
  label: string;
  type: 'secret' | 'text';
  required?: boolean;
  envVar?: string;
  placeholder?: string;
};

export type BuildInputRequirement = {
  id: string;
  label: string;
  kind: BuildInputKind;
  description: string;
  reason: string;
  required: boolean;
  minCount?: number;
  acceptedExtensions?: string[];
  provider?: string;
  reusable?: boolean;
  fields?: RequirementField[];
  examples?: string[];
};

export type RequirementFulfillment = {
  intakeId: string;
  requirementId: string;
  status: 'provided';
  summary: string;
  fileCount?: number;
  displayName?: string;
  storedPaths?: string[];
  fileHashes?: string[];
  values?: Record<string, string>;
  credentialKeys?: Record<string, string>;
  updatedAt: string;
};

export type BuildRequirementState = {
  requirement: BuildInputRequirement;
  satisfied: boolean;
  source: 'missing' | 'project' | 'saved' | 'environment' | 'local-account';
  summary: string;
  fileCount?: number;
  updatedAt?: string;
};

export type BuildBriefContent = {
  outcome: string;
  users: string[];
  flows: string[];
  requirements: string[];
  designDirection: string[];
  dataAndIntegrations: string[];
  exclusions: string[];
  acceptanceTests: string[];
  assumptions: string[];
};

export type BuildBrief = {
  id: string;
  intakeId: string;
  version: number;
  content: BuildBriefContent;
  requiredInputs: BuildInputRequirement[];
  visualCoverage: { inspectedPages: number; totalPages: number; complete: boolean };
  createdAt?: string;
};

export type BriefDecision = {
  decisionId: string;
  question: string;
  resolution: string;
  required: boolean;
  resolvedAt?: string;
};

export type ApprovalBuildConfiguration = {
  repository: string;
  backend: 'supabase' | 'appwrite' | 'firebase' | 'none';
  deployment: 'local' | 'vercel' | 'none';
  workflow: 'windmill' | 'none';
  needsAuthenticatedBrowser: boolean;
  needsWindowsHost: boolean;
  target?: BuildTargetSelection;
};

export type ApprovalHashInput = {
  brief: BuildBrief;
  sources: SourceManifestItem[];
  decisions: BriefDecision[];
  design?: DesignContract | null;
  requirements?: unknown[];
  buildConfiguration: ApprovalBuildConfiguration;
};

export type ApprovalContract = {
  approvalId: string;
  projectId: string;
  intakeId: string;
  briefVersionId: string;
  hash: string;
  approvedAt: string;
  buildConfiguration: ApprovalBuildConfiguration;
};

export type ProjectEvent = {
  sequence: number;
  eventId: string;
  projectId: string;
  buildId?: string;
  jobId?: string;
  timestamp: string;
  category: string;
  stage: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  source: string;
  humanMessage: string;
  technicalPayload?: unknown;
  target?: ExecutionTarget | 'user' | 'local-vision';
};
