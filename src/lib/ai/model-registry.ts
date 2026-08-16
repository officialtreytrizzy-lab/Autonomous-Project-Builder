import { geminiConfigured } from './gemini.ts';

export type ModelRole = 'implementation-brain' | 'design' | 'coding-backup' | 'multimodal-worker' | 'tool-router' | 'hard-escalation' | 'audio-analysis';

export type ModelDescriptor = {
  role: ModelRole;
  label: string;
  provider: 'gemini' | 'openrouter' | 'modal' | 'local' | 'external' | 'existing';
  model: string;
  fallbackModels?: string[];
  enabledByDefault: boolean;
  multimodal: boolean;
  purpose: string;
  endpointEnv?: string;
  apiKeyEnv?: string;
};

export const MODEL_REGISTRY: Record<ModelRole, ModelDescriptor> = {
  'implementation-brain': {
    role: 'implementation-brain',
    label: 'ChatGPT Implementation Brain',
    provider: 'existing',
    model: 'authenticated-chatgpt-thread',
    enabledByDefault: true,
    multimodal: true,
    purpose: 'Primary reasoning and implementation brain for full autonomous builds.',
  },
  design: {
    role: 'design',
    label: 'Gemini 3.7 Visual Design Director',
    provider: 'gemini',
    model: process.env.BUILDER_DESIGN_MODEL?.trim() || 'gemini-3.7-flash',
    fallbackModels: [process.env.BUILDER_DESIGN_FALLBACK_MODEL?.trim() || 'gemini-flash-latest'],
    enabledByDefault: true,
    multimodal: true,
    purpose: 'Gemini 3.7 Flash creates the precise UI/UX specification and performs design-parity QA; Cloudflare Workers AI renders the approved visual mockup template.',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  'coding-backup': {
    role: 'coding-backup',
    label: 'North Mini Code Free',
    provider: 'openrouter',
    model: process.env.BUILDER_CODING_BACKUP_MODEL?.trim() || 'cohere/north-mini-code:free',
    enabledByDefault: true,
    multimodal: false,
    purpose: 'Free agentic coding specialist for code generation, terminal-oriented software engineering, and implementation backup.',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  'multimodal-worker': {
    role: 'multimodal-worker',
    label: 'TreyGPT Qwen3.6-27B Multimodal Worker',
    provider: 'modal',
    model: process.env.BUILDER_MULTIMODAL_MODEL?.trim() || 'TREY-GPT',
    enabledByDefault: false,
    multimodal: true,
    purpose: 'Existing open-weight TreyGPT worker for coding, screenshot understanding, repo analysis, and routine multimodal agent work.',
    endpointEnv: 'BUILDER_QWEN_MULTIMODAL_ENDPOINT',
    apiKeyEnv: 'BUILDER_QWEN_MULTIMODAL_API_KEY',
  },
  'tool-router': {
    role: 'tool-router',
    label: 'Needle 2 Tool Router',
    provider: 'local',
    model: process.env.BUILDER_TOOL_ROUTER_MODEL?.trim() || 'needle-2',
    enabledByDefault: false,
    multimodal: false,
    purpose: 'Tiny local classifier/router for deterministic MCP tool dispatch.',
    endpointEnv: 'BUILDER_NEEDLE_ENDPOINT',
  },
  'hard-escalation': {
    role: 'hard-escalation',
    label: 'Nemotron 3 Ultra Free Reasoning',
    provider: 'openrouter',
    model: process.env.BUILDER_FREE_REASONING_MODEL?.trim() || 'nvidia/nemotron-3-ultra-550b-a55b:free',
    enabledByDefault: true,
    multimodal: false,
    purpose: 'Free long-context reasoning, planning, research, orchestration, and difficult coding backup without replacing the primary ChatGPT implementation brain.',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  'audio-analysis': {
    role: 'audio-analysis',
    label: 'Existing Trizzy Audio Analysis Lane',
    provider: 'existing',
    model: 'existing-trizzy-audio-analysis',
    enabledByDefault: true,
    multimodal: true,
    purpose: 'Preserves the current proven Trizzy Vox/Suno listening and analysis path.',
  },
};

export function modelFor(role: ModelRole) {
  return MODEL_REGISTRY[role];
}

export function modelRegistryStatus() {
  return Object.values(MODEL_REGISTRY).map((descriptor) => {
    const freePolicyBlocked = descriptor.provider === 'openrouter' && !descriptor.model.endsWith(':free');
    const configured = !freePolicyBlocked && (
      descriptor.provider === 'existing'
      || (descriptor.provider === 'gemini' && geminiConfigured())
      || (descriptor.apiKeyEnv ? Boolean(process.env[descriptor.apiKeyEnv]?.trim()) : false)
      || (descriptor.endpointEnv ? Boolean(process.env[descriptor.endpointEnv]?.trim()) : false)
    );
    return { ...descriptor, configured, freePolicyBlocked };
  });
}
