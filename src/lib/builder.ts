export type IngredientLevel = 'green' | 'yellow' | 'red';
export type ExecutionTarget = 'docker-mcp' | 'computer-2' | 'windmill' | 'cloud' | 'user';

export type Ingredient = {
  id: string;
  label: string;
  level: IngredientLevel;
  required: boolean;
  available: boolean;
  target: ExecutionTarget;
  detail: string;
  blocking: boolean;
};

export type BuildRequest = {
  repository?: string;
  backend?: 'supabase' | 'appwrite' | 'firebase' | 'none';
  deployment?: 'vercel' | 'none';
  workflow?: 'windmill' | 'none';
  needsAuthenticatedBrowser?: boolean;
  needsWindowsHost?: boolean;
};

export const APPROVAL_CONTINUATION_POLICY =
  'After the user approves a build direction, continue through recoverable failures and non-blocking missing ingredients. Interrupt only for user-only input, an irreversible high-impact decision, or a dependency that truly prevents further progress.';

export function analyzeIngredients(input: BuildRequest): Ingredient[] {
  const ingredients: Ingredient[] = [];

  if (input.repository) {
    ingredients.push({
      id: 'repository', label: 'Repository', level: 'green', required: true, available: true,
      target: 'docker-mcp', detail: input.repository, blocking: false,
    });
  } else {
    ingredients.push({
      id: 'repository', label: 'Repository', level: 'red', required: true, available: false,
      target: 'user', detail: 'A repository is required before implementation can be persisted.', blocking: true,
    });
  }

  if (input.backend && input.backend !== 'none') {
    ingredients.push({
      id: 'backend', label: 'Backend', level: 'yellow', required: true, available: true,
      target: 'docker-mcp', detail: `${input.backend} selected. Account/project credentials are validated at execution time.`, blocking: false,
    });
  }

  if (input.deployment === 'vercel') {
    ingredients.push({
      id: 'deployment', label: 'Deployment', level: 'yellow', required: true, available: true,
      target: 'docker-mcp', detail: 'Vercel selected. Identity and project access are validated before deployment.', blocking: false,
    });
  }

  if (input.workflow === 'windmill') {
    ingredients.push({
      id: 'workflow', label: 'Workflow Engine', level: 'green', required: false, available: true,
      target: 'windmill', detail: 'Self-hosted Windmill runtime is the long-running workflow target.', blocking: false,
    });
  }

  if (input.needsAuthenticatedBrowser) {
    ingredients.push({
      id: 'browser', label: 'Authenticated Browser', level: 'green', required: true, available: true,
      target: 'computer-2', detail: 'Use the authenticated Google Chrome bridge on Computer 2.', blocking: false,
    });
  }

  if (input.needsWindowsHost) {
    ingredients.push({
      id: 'host', label: 'Windows Host', level: 'green', required: true, available: true,
      target: 'computer-2', detail: 'Machine-native work stays on the Computer 2 host layer.', blocking: false,
    });
  }

  return ingredients;
}

export function shouldInterrupt(ingredients: Ingredient[]): boolean {
  return ingredients.some((ingredient) => ingredient.level === 'red' && ingredient.blocking);
}

export function routeCapability(capability: string): ExecutionTarget {
  const value = capability.toLowerCase();
  if (/chrome|browser|windows|desktop|notepad|local app|host terminal|screen|mouse|keyboard/.test(value)) return 'computer-2';
  if (/workflow|schedule|long[- ]running|queue|orchestrat/.test(value)) return 'windmill';
  if (/github|git|supabase|vercel|appwrite|api|service|docs/.test(value)) return 'docker-mcp';
  return 'cloud';
}
