import type { BuildBrief, BriefDecision, BuildRequirementState, ProjectEvent, ProjectState, SourceManifestItem } from '@/lib/intake/types';
import type { DesignContract, DesignSession } from '@/lib/design/types';
import type { BuildTargetSelection } from '@/lib/target-platform';

export type BuilderProject = {
  id: string;
  name: string;
  objective: string;
  buildTarget: BuildTargetSelection;
  workspaceMode?: 'managed' | 'existing';
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
  requirements?: BuildRequirementState[];
  designSession?: DesignSession | null;
  design?: DesignContract | null;
  approval?: { hash: string; approvedAt: string } | null;
  citations?: Citation[];
};

export type UiMode = 'Compose' | 'Understand' | 'Design' | 'Approve & Build' | 'Build';
export type { ProjectEvent };
