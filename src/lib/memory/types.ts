export type SemanticMemorySegment = {
  id: string;
  projectId: string;
  kind: 'design' | 'build' | 'repair' | 'decision' | 'verification' | 'system';
  title: string;
  content: string;
  tags: string[];
  sourceRef?: string;
  confidence: number;
  createdAt: string;
};

export type BuilderLesson = {
  id: string;
  projectId: string;
  status: 'candidate' | 'validated' | 'rejected';
  trigger: string;
  lesson: string;
  proposedChange: string;
  evidence: string[];
  regression: {
    beforePassed?: boolean;
    afterPassed?: boolean;
    improved?: boolean;
    note?: string;
  };
  createdAt: string;
  updatedAt: string;
};
