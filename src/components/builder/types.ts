import type { BuildBrief, BriefDecision, ProjectEvent, ProjectState, SourceManifestItem } from '@/lib/intake/types';

export type BuilderProject = {
  id: string;
  name: string;
  objective: string;
  state: ProjectState;
  currentIntakeId: string;
  activeBuildId: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicSource = SourceManifestItem;

export type Citation = {
  evidenceId: string;
  sourceId: string;
  revisionId: string;
  page?: number;
  region?: { x: number; y: number; width: number; height: number };
  kind: string;
  content: string;
  relationships: string[];
  confidence: number;
  artifactAvailable: boolean;
};

export type IntakeView = {
  intake: {
    id: string;
    projectId: string;
    status: string;
    planId: string;
    jobId: string;
    createdAt: string;
    updatedAt: string;
  };
  sources: PublicSource[];
  brief: BuildBrief | null;
  decisions: BriefDecision[];
  approval?: { hash: string; approvedAt: string } | null;
  citations?: Citation[];
};

export type UiMode = 'Compose' | 'Understand' | 'Approve & Build' | 'Build';
export type { ProjectEvent };
