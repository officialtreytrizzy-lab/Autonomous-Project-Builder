export type DesignMockup = {
  mockupId: string;
  label: string;
  viewport: 'desktop' | 'mobile' | 'detail';
  aspectRatio: string;
  imageSize: '1K' | '2K' | '4K';
  mimeType: string;
  fileName: string;
  model: string;
  createdAt: string;
  approvedRelativePath?: string;
  origin?: 'generated' | 'imported';
  sourceName?: string;
  sourcePage?: number;
};


export type DesignMessage = {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export type DesignSession = {
  intakeId: string;
  projectId: string;
  provider: 'gemini' | 'openrouter' | string;
  model: string;
  status: 'draft' | 'approved';
  messages: DesignMessage[];
  selectedElements?: string[];
  mockups?: DesignMockup[];
  createdAt: string;
  updatedAt: string;
};

export type DesignReferenceFile = {
  name: string;
  size: number;
  type: string;
  dataUrl?: string;
  extractedText?: string;
};

export type DesignTemplateOptions = {
  elements?: string[];
  referenceFiles?: DesignReferenceFile[];
  prompt?: string;
  constructTemplate?: boolean;
};

export type DesignGenerationMode = 'auto' | 'assisted' | 'manual';

export type DesignGenerationPacket = {
  version: 1;
  projectOutcome: string;
  screenRequirements: string[];
  componentRequirements: string[];
  desktopRequirements: string[];
  mobileRequirements: string[];
  brandDirection: string[];
  uxRequirements: string[];
  referenceFiles: string[];
  chatgptPrompt: string;
  geminiPrompt: string;
  importInstructions: string[];
};


export type DesignContract = {
  id: string;
  intakeId: string;
  projectId: string;
  version: number;
  status: 'approved';
  provider: 'gemini' | 'openrouter' | string;
  model: string;
  approvedAt: string;
  summary: string;
  principles: string[];
  designSystem: {
    visualLanguage: string;
    typography: string[];
    colorAndMaterial: string[];
    spacingAndShape: string[];
    elevationAndDepth: string[];
    motion: string[];
    tokens?: Record<string, string>;
  };
  screens: Array<{
    name: string;
    purpose: string;
    layout: string[];
    components: string[];
    states: string[];
    mobile: string[];
    desktop: string[];
  }>;
  interactions: string[];
  responsiveRules: string[];
  accessibility: string[];
  assets: string[];
  implementationRules: string[];
  visualAcceptance: string[];
  selectedElements?: string[];
  mockups?: DesignMockup[];
};

export type DesignVisualQa = {
  id: string;
  intakeId: string;
  projectId: string;
  designId: string;
  model: string;
  score: number;
  threshold: number;
  passed: boolean;
  summary: string;
  strengths: string[];
  mismatches: Array<{
    area: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    expected: string;
    observed: string;
    repair: string;
  }>;
  screenshots: string[];
  createdAt: string;
};
