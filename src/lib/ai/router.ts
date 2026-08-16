import { modelRegistryStatus, type ModelDescriptor, type ModelRole } from './model-registry.ts';

export type RoutedTask = {
  kind: 'design' | 'implementation' | 'coding' | 'visual-qa' | 'tool-dispatch' | 'audio-analysis' | 'research';
  complexity?: 'low' | 'normal' | 'high';
  hasImages?: boolean;
  preferLocal?: boolean;
};

export type RouteDecision = { primary: ModelDescriptor; fallbacks: ModelDescriptor[]; reason: string };

function available(role: ModelRole) {
  return modelRegistryStatus().find((model) => model.role === role && (model.configured || model.provider === 'existing'));
}

function configuredRoles(roles: ModelRole[]) {
  return roles.map(available).filter((model): model is NonNullable<ReturnType<typeof available>> => Boolean(model));
}

export function routeAiTask(task: RoutedTask): RouteDecision {
  let roles: ModelRole[];
  let reason: string;
  if (task.kind === 'design') {
    roles = ['design', 'implementation-brain'];
    reason = 'Visual design uses the connected design-reasoning lane to create or analyze an authoritative Design Package. Direct image rendering is optional because assisted ChatGPT/Gemini generation and manual imports use the same Design Lock and visual-QA path.';
  } else if (task.kind === 'audio-analysis') {
    roles = ['audio-analysis', 'implementation-brain'];
    reason = 'Audio analysis stays on the existing proven audio lane.';
  } else if (task.kind === 'tool-dispatch') {
    roles = ['tool-router', 'implementation-brain', 'coding-backup'];
    reason = 'Use the tiny tool router when configured, while keeping ChatGPT primary for substantive reasoning.';
  } else if (task.kind === 'visual-qa' || task.hasImages) {
    roles = ['multimodal-worker', 'design', 'implementation-brain'];
    reason = 'Visual work prefers a configured multimodal specialist and keeps ChatGPT as a safe fallback.';
  } else if (task.complexity === 'high') {
    roles = ['implementation-brain', 'hard-escalation', 'coding-backup', 'multimodal-worker'];
    reason = 'ChatGPT remains the implementation brain; free Nemotron and North Mini Code are available as specialist fallbacks for difficult work.';
  } else if (task.kind === 'coding') {
    roles = task.preferLocal
      ? ['implementation-brain', 'multimodal-worker', 'coding-backup', 'hard-escalation']
      : ['implementation-brain', 'coding-backup', 'hard-escalation', 'multimodal-worker'];
    reason = 'Coding stays on ChatGPT first, with the free North Mini Code and Nemotron specialists available behind it.';
  } else if (task.kind === 'research') {
    roles = ['implementation-brain', 'hard-escalation', 'coding-backup'];
    reason = 'Research stays on ChatGPT first, with the 1M-context free Nemotron reasoning lane available behind it.';
  } else {
    roles = ['implementation-brain', 'coding-backup', 'hard-escalation', 'multimodal-worker'];
    reason = 'Full implementation remains on the existing ChatGPT build brain by default, with free OpenRouter specialists behind it.';
  }
  const models = configuredRoles(roles);
  if (!models.length) throw new Error('No configured AI route is available for this task');
  return { primary: models[0], fallbacks: models.slice(1), reason };
}
