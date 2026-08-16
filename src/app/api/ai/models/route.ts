import { modelRegistryStatus } from '@/lib/ai/model-registry';
import { routeAiTask, type RoutedTask } from '@/lib/ai/router';

export async function GET() {
  const models = modelRegistryStatus();
  const examples: RoutedTask[] = [
    { kind: 'implementation' },
    { kind: 'coding' },
    { kind: 'coding', complexity: 'high' },
    { kind: 'design' },
    { kind: 'visual-qa', hasImages: true },
    { kind: 'tool-dispatch', complexity: 'low' },
    { kind: 'research', complexity: 'high' },
    { kind: 'audio-analysis' },
  ];
  return Response.json({
    models,
    freeOpenRouterSpecialists: models
      .filter((model) => model.provider === 'openrouter' && model.model.endsWith(':free'))
      .map((model) => ({ role: model.role, label: model.label, model: model.model, configured: model.configured, multimodal: model.multimodal })),
    routes: examples.map((task) => {
      const decision = routeAiTask(task);
      return {
        task,
        primary: decision.primary.role,
        fallbacks: decision.fallbacks.map((model) => model.role),
        reason: decision.reason,
      };
    }),
  });
}
