export type IngredientLevel = 'green' | 'yellow' | 'red';
export type ExecutionTarget = 'docker-mcp' | 'computer-2' | 'windmill' | 'cloud' | 'user';
export type BuildStage = 'intake' | 'analysis' | 'ready' | 'running' | 'blocked' | 'complete' | 'failed';

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
  name?: string;
  objective?: string;
  repository?: string;
  backend?: 'supabase' | 'appwrite' | 'firebase' | 'none';
  deployment?: 'vercel' | 'none';
  workflow?: 'windmill' | 'none';
  needsAuthenticatedBrowser?: boolean;
  needsWindowsHost?: boolean;
};

export type ExecutionStep = {
  id: string;
  title: string;
  target: ExecutionTarget;
  status: 'queued' | 'ready' | 'blocked';
  reason: string;
};

export type BuildAnalysis = {
  request: BuildRequest;
  ingredients: Ingredient[];
  steps: ExecutionStep[];
  stage: BuildStage;
  blockingCount: number;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  canContinue: boolean;
};

export const APPROVAL_CONTINUATION_POLICY =
  'After the user approves a build direction, continue through recoverable failures and non-blocking missing ingredients. Interrupt only for user-only input, an irreversible high-impact decision, or a dependency that truly prevents further progress.';

function ingredient(input: Omit<Ingredient, 'blocking'> & { blocking?: boolean }): Ingredient {
  return { ...input, blocking: input.blocking ?? false };
}

export function analyzeIngredients(input: BuildRequest): Ingredient[] {
  const ingredients: Ingredient[] = [];

  ingredients.push(input.repository
    ? ingredient({ id: 'repository', label: 'Repository', level: 'green', required: true, available: true, target: 'docker-mcp', detail: input.repository })
    : ingredient({ id: 'repository', label: 'Repository', level: 'red', required: true, available: false, target: 'user', detail: 'A repository is required before implementation can be persisted.', blocking: true }));

  if (input.backend && input.backend !== 'none') {
    ingredients.push(ingredient({
      id: 'backend', label: 'Backend', level: 'yellow', required: true, available: true,
      target: 'docker-mcp', detail: `${input.backend} selected. Existing account/project access will be checked before provisioning.`,
    }));
  } else {
    ingredients.push(ingredient({ id: 'backend', label: 'Backend', level: 'green', required: false, available: true, target: 'cloud', detail: 'No backend requested for this build.' }));
  }

  if (input.deployment === 'vercel') {
    ingredients.push(ingredient({ id: 'deployment', label: 'Deployment', level: 'yellow', required: true, available: true, target: 'docker-mcp', detail: 'Vercel selected. Identity and project access will be validated before production deployment.' }));
  } else {
    ingredients.push(ingredient({ id: 'deployment', label: 'Deployment', level: 'green', required: false, available: true, target: 'cloud', detail: 'No deployment target requested.' }));
  }

  if (input.workflow === 'windmill') {
    ingredients.push(ingredient({ id: 'workflow', label: 'Workflow Engine', level: 'green', required: false, available: true, target: 'windmill', detail: 'Self-hosted Windmill runtime is the long-running workflow target.' }));
  } else {
    ingredients.push(ingredient({ id: 'workflow', label: 'Workflow Engine', level: 'green', required: false, available: true, target: 'cloud', detail: 'No long-running workflow engine requested.' }));
  }

  ingredients.push(input.needsAuthenticatedBrowser
    ? ingredient({ id: 'browser', label: 'Authenticated Browser', level: 'green', required: true, available: true, target: 'computer-2', detail: 'Use authenticated Google Chrome on Computer 2.' })
    : ingredient({ id: 'browser', label: 'Authenticated Browser', level: 'green', required: false, available: true, target: 'computer-2', detail: 'Authenticated browser control is not required.' }));

  ingredients.push(input.needsWindowsHost
    ? ingredient({ id: 'host', label: 'Windows Host', level: 'green', required: true, available: true, target: 'computer-2', detail: 'Machine-native work stays on the Computer 2 host layer.' })
    : ingredient({ id: 'host', label: 'Windows Host', level: 'green', required: false, available: true, target: 'computer-2', detail: 'No Windows-host-only work requested.' }));

  return ingredients;
}

export function shouldInterrupt(ingredients: Ingredient[]): boolean {
  return ingredients.some((item) => item.level === 'red' && item.blocking);
}

export function routeCapability(capability: string): ExecutionTarget {
  const value = capability.toLowerCase();
  if (/chrome|browser|windows|desktop|notepad|local app|host terminal|screen|mouse|keyboard/.test(value)) return 'computer-2';
  if (/workflow|schedule|long[- ]running|queue|orchestrat|job/.test(value)) return 'windmill';
  if (/github|git|supabase|vercel|appwrite|firebase|api|service|docs|repository|deploy/.test(value)) return 'docker-mcp';
  return 'cloud';
}

export function buildExecutionPlan(input: BuildRequest, ingredients = analyzeIngredients(input)): ExecutionStep[] {
  const blocked = shouldInterrupt(ingredients);
  const steps: ExecutionStep[] = [
    { id: 'inspect', title: 'Inspect repository and existing resources', target: 'docker-mcp', status: blocked ? 'blocked' : 'ready', reason: 'Reuse existing resources before creating or buying anything.' },
    { id: 'host', title: 'Prepare build machine and local workspace', target: input.needsWindowsHost ? 'computer-2' : 'cloud', status: blocked ? 'blocked' : 'ready', reason: input.needsWindowsHost ? 'Host-native work belongs on Computer 2.' : 'No host-only dependency detected.' },
  ];

  if (input.backend && input.backend !== 'none') steps.push({ id: 'backend', title: `Validate and configure ${input.backend}`, target: 'docker-mcp', status: blocked ? 'blocked' : 'ready', reason: 'Service integrations route through Docker MCP.' });
  if (input.needsAuthenticatedBrowser) steps.push({ id: 'browser', title: 'Run authenticated browser actions', target: 'computer-2', status: blocked ? 'blocked' : 'ready', reason: 'Real signed-in Chrome remains on the Windows host.' });
  if (input.workflow === 'windmill') steps.push({ id: 'workflow', title: 'Create durable workflow/job orchestration', target: 'windmill', status: blocked ? 'blocked' : 'ready', reason: 'Long-running and resumable work belongs in Windmill.' });
  steps.push({ id: 'verify', title: 'Run typecheck, lint, tests, build and regression', target: 'computer-2', status: blocked ? 'blocked' : 'ready', reason: 'Production certification runs against the actual build machine.' });
  if (input.deployment === 'vercel') steps.push({ id: 'deploy', title: 'Deploy and verify production', target: 'docker-mcp', status: blocked ? 'blocked' : 'ready', reason: 'Deployment is a service integration handled through the portable MCP layer.' });
  return steps;
}

export function analyzeBuild(input: BuildRequest): BuildAnalysis {
  const ingredients = analyzeIngredients(input);
  const blockingCount = ingredients.filter((item) => item.level === 'red' && item.blocking).length;
  const redCount = ingredients.filter((item) => item.level === 'red').length;
  const yellowCount = ingredients.filter((item) => item.level === 'yellow').length;
  const greenCount = ingredients.filter((item) => item.level === 'green').length;
  const canContinue = blockingCount === 0;
  return { request: input, ingredients, steps: buildExecutionPlan(input, ingredients), stage: canContinue ? 'ready' : 'blocked', blockingCount, greenCount, yellowCount, redCount, canContinue };
}
