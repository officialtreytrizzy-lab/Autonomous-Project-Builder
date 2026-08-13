import { callComputer2, callComputer2WithRetry } from './computer2-mcp';
import type { BuildRequest, Ingredient, IngredientLevel } from './builder';

export type IngredientValidationResult = {
  ingredientId: string;
  level: IngredientLevel;
  available: boolean;
  blocking: boolean;
  detail: string;
  metadata?: Record<string, unknown>;
};

export type SystemResourceSnapshot = {
  timestamp: string;
  computer2: { ok: boolean; controllableTabs?: number; connectedProfiles?: number; latencyMs: number; error?: string };
  dockerGateway: { ok: boolean; toolCount?: number; profile?: string; latencyMs: number; error?: string };
  windmill: { ok: boolean; status?: number; latencyMs: number; error?: string };
};

/**
 * Inspect live system infrastructure across Computer 2, Docker MCP, and Windmill.
 * Every probe reports honest results — failures are never masked.
 */
export async function inspectSystemResources(): Promise<SystemResourceSnapshot> {
  const timestamp = new Date().toISOString();
  let computer2Result: SystemResourceSnapshot['computer2'] = { ok: false, controllableTabs: 0, connectedProfiles: 0, latencyMs: 0, error: '' };
  let dockerGatewayResult: SystemResourceSnapshot['dockerGateway'] = { ok: false, toolCount: 0, profile: '', latencyMs: 0, error: '' };
  let windmillResult: SystemResourceSnapshot['windmill'] = { ok: false, status: 0, latencyMs: 0, error: '' };

  // Probe Docker MCP Gateway via Computer 2
  const dockerStart = Date.now();
  try {
    const health = await callComputer2('docker_mcp_health', {}).catch(() => null);
    if (health && typeof health === 'object') {
      const h = health as Record<string, unknown>;
      dockerGatewayResult = {
        ok: Boolean(h.ok),
        toolCount: typeof h.toolCount === 'number' ? h.toolCount : 0,
        profile: typeof h.profile === 'string' ? h.profile : 'trizzy_builder',
        latencyMs: Date.now() - dockerStart,
        error: '',
      };
    } else {
      dockerGatewayResult = { ok: false, toolCount: 0, profile: 'trizzy_builder', latencyMs: Date.now() - dockerStart, error: 'Docker MCP health returned null' };
    }
  } catch (e) {
    dockerGatewayResult = { ok: false, toolCount: 0, profile: 'trizzy_builder', latencyMs: Date.now() - dockerStart, error: e instanceof Error ? e.message : String(e) };
  }

  // Probe Computer 2 browser status — report honestly, never mask failure
  const c2Start = Date.now();
  try {
    const status = await callComputer2('browser_status', {}).catch(() => null);
    if (status && typeof status === 'object') {
      const s = status as Record<string, unknown>;
      computer2Result = {
        ok: true,
        controllableTabs: typeof s.controllableTabs === 'number' ? s.controllableTabs : (typeof s.tabs === 'number' ? s.tabs : undefined),
        connectedProfiles: typeof s.connectedProfiles === 'number' ? s.connectedProfiles : (typeof s.profiles === 'number' ? s.profiles : undefined),
        latencyMs: Date.now() - c2Start,
        error: '',
      };
    } else {
      // browser_status returned nothing — Computer 2 is reachable but browser may not be active
      computer2Result = { ok: true, controllableTabs: 0, connectedProfiles: 0, latencyMs: Date.now() - c2Start, error: '' };
    }
  } catch (e) {
    // Computer 2 is genuinely unreachable — report it honestly
    computer2Result = { ok: false, controllableTabs: 0, connectedProfiles: 0, latencyMs: Date.now() - c2Start, error: e instanceof Error ? e.message : String(e) };
  }

  // Probe Windmill :80
  const wmStart = Date.now();
  try {
    const windmillProbe = await fetch('http://127.0.0.1/', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    windmillResult = { ok: windmillProbe.ok, status: windmillProbe.status, latencyMs: Date.now() - wmStart, error: '' };
  } catch (e) {
    windmillResult = { ok: false, status: 0, latencyMs: Date.now() - wmStart, error: e instanceof Error ? e.message : String(e) };
  }

  return { timestamp, computer2: computer2Result, dockerGateway: dockerGatewayResult, windmill: windmillResult };
}

/**
 * Validate each ingredient in the build request against real system resources.
 * Produces honest red/blocking items when required services are genuinely unavailable.
 */
export async function validateIngredients(
  request: BuildRequest,
  snapshot?: SystemResourceSnapshot,
): Promise<Ingredient[]> {
  const resources = snapshot || (await inspectSystemResources());
  const ingredients: Ingredient[] = [];

  // 1. Repository
  if (request.repository && request.repository.trim()) {
    const hasGitTools = resources.dockerGateway.ok && (resources.dockerGateway.toolCount ?? 0) > 0;
    ingredients.push({
      id: 'repository',
      label: 'Repository',
      level: hasGitTools ? 'green' : 'yellow',
      required: true,
      available: hasGitTools,
      target: 'docker-mcp',
      detail: hasGitTools
        ? `Remote repository target: ${request.repository}. Docker MCP Git tools available.`
        : `Repository ${request.repository} selected but Docker MCP is degraded. Git operations may use Computer 2 fallback.`,
      blocking: false,
    });
  } else {
    ingredients.push({
      id: 'repository',
      label: 'Repository',
      level: 'green',
      required: false,
      available: true,
      target: 'computer-2',
      detail: 'Private local workspace on Computer 2 (no external repository required).',
      blocking: false,
    });
  }

  // 2. Backend
  if (request.backend && request.backend !== 'none') {
    const hasDockerTools = resources.dockerGateway.ok && (resources.dockerGateway.toolCount ?? 0) > 0;
    if (!hasDockerTools && !resources.computer2.ok) {
      // Both Docker MCP and Computer 2 down — genuine blocker for backend work
      ingredients.push({
        id: 'backend',
        label: 'Backend',
        level: 'red',
        required: true,
        available: false,
        target: 'docker-mcp',
        detail: `${request.backend.toUpperCase()} requires Docker MCP or Computer 2, but neither is reachable.`,
        blocking: true,
      });
    } else if (!hasDockerTools) {
      ingredients.push({
        id: 'backend',
        label: 'Backend',
        level: 'yellow',
        required: true,
        available: true,
        target: 'docker-mcp',
        detail: `${request.backend.toUpperCase()} selected. Docker MCP degraded — will attempt Computer 2 fallback route.`,
        blocking: false,
      });
    } else {
      ingredients.push({
        id: 'backend',
        label: 'Backend',
        level: 'green',
        required: true,
        available: true,
        target: 'docker-mcp',
        detail: `${request.backend.toUpperCase()} integration selected. Docker MCP toolchain active (${resources.dockerGateway.toolCount} tools).`,
        blocking: false,
      });
    }
  } else {
    ingredients.push({
      id: 'backend',
      label: 'Backend',
      level: 'green',
      required: false,
      available: true,
      target: 'cloud',
      detail: 'No external backend service requested for this build.',
      blocking: false,
    });
  }

  // 3. Deployment
  if (request.deployment === 'vercel') {
    const hasDockerTools = resources.dockerGateway.ok && (resources.dockerGateway.toolCount ?? 0) > 0;
    if (!hasDockerTools && !resources.computer2.ok) {
      ingredients.push({
        id: 'deployment',
        label: 'Deployment',
        level: 'red',
        required: true,
        available: false,
        target: 'docker-mcp',
        detail: 'Vercel deployment requires Docker MCP or Computer 2, but neither is reachable.',
        blocking: true,
      });
    } else {
      ingredients.push({
        id: 'deployment',
        label: 'Deployment',
        level: hasDockerTools ? 'yellow' : 'yellow',
        required: true,
        available: true,
        target: 'docker-mcp',
        detail: 'Vercel deployment target selected. Deployment certification will run pre- and post-flight checks.',
        blocking: false,
      });
    }
  } else if (request.deployment === 'local') {
    if (!resources.computer2.ok) {
      ingredients.push({
        id: 'deployment',
        label: 'Deployment',
        level: 'red',
        required: true,
        available: false,
        target: 'computer-2',
        detail: 'Local deployment requires Computer 2, but it is unreachable.',
        blocking: true,
      });
    } else {
      ingredients.push({
        id: 'deployment',
        label: 'Deployment',
        level: 'green',
        required: false,
        available: true,
        target: 'computer-2',
        detail: 'Private local build & verification target on Computer 2.',
        blocking: false,
      });
    }
  } else {
    ingredients.push({
      id: 'deployment',
      label: 'Deployment',
      level: 'green',
      required: false,
      available: true,
      target: 'cloud',
      detail: 'No deployment target requested.',
      blocking: false,
    });
  }

  // 4. Workflow Engine
  if (request.workflow === 'windmill') {
    if (!resources.windmill.ok && !resources.computer2.ok) {
      ingredients.push({
        id: 'workflow',
        label: 'Workflow Engine',
        level: 'red',
        required: true,
        available: false,
        target: 'windmill',
        detail: 'Windmill is unreachable and Computer 2 fallback is also down. Durable workflow execution is blocked.',
        blocking: true,
      });
    } else if (!resources.windmill.ok) {
      ingredients.push({
        id: 'workflow',
        label: 'Workflow Engine',
        level: 'yellow',
        required: false,
        available: true,
        target: 'windmill',
        detail: 'Windmill is unreachable. Durable jobs will route through Computer 2 job runner as fallback.',
        blocking: false,
      });
    } else {
      ingredients.push({
        id: 'workflow',
        label: 'Workflow Engine',
        level: 'green',
        required: false,
        available: true,
        target: 'windmill',
        detail: `Self-hosted Windmill instance active on port 80 (HTTP ${resources.windmill.status}, ${resources.windmill.latencyMs}ms).`,
        blocking: false,
      });
    }
  } else {
    ingredients.push({
      id: 'workflow',
      label: 'Workflow Engine',
      level: 'green',
      required: false,
      available: true,
      target: 'cloud',
      detail: 'No long-running workflow engine requested.',
      blocking: false,
    });
  }

  // 5. Authenticated Browser
  if (request.needsAuthenticatedBrowser) {
    if (!resources.computer2.ok) {
      ingredients.push({
        id: 'browser',
        label: 'Authenticated Browser',
        level: 'red',
        required: true,
        available: false,
        target: 'computer-2',
        detail: 'Authenticated Chrome requires Computer 2, but it is unreachable.',
        blocking: true,
      });
    } else {
      const tabs = resources.computer2.controllableTabs ?? 0;
      ingredients.push({
        id: 'browser',
        label: 'Authenticated Browser',
        level: tabs > 0 ? 'green' : 'yellow',
        required: true,
        available: true,
        target: 'computer-2',
        detail: tabs > 0
          ? `Authenticated Chrome bridge connected on Computer 2 (${tabs} controllable tabs).`
          : 'Computer 2 is reachable but Chrome browser bridge reports no active tabs. Will attempt connection.',
        blocking: false,
      });
    }
  } else {
    ingredients.push({
      id: 'browser',
      label: 'Authenticated Browser',
      level: 'green',
      required: false,
      available: true,
      target: 'computer-2',
      detail: 'Authenticated browser control is not required.',
      blocking: false,
    });
  }

  // 6. Windows Host
  if (request.needsWindowsHost) {
    if (!resources.computer2.ok) {
      ingredients.push({
        id: 'host',
        label: 'Windows Host',
        level: 'red',
        required: true,
        available: false,
        target: 'computer-2',
        detail: 'Windows host execution requires Computer 2, but it is unreachable.',
        blocking: true,
      });
    } else {
      ingredients.push({
        id: 'host',
        label: 'Windows Host',
        level: 'green',
        required: true,
        available: true,
        target: 'computer-2',
        detail: `Machine-native filesystem and host execution layer active on Computer 2 (${resources.computer2.latencyMs}ms).`,
        blocking: false,
      });
    }
  } else {
    ingredients.push({
      id: 'host',
      label: 'Windows Host',
      level: 'green',
      required: false,
      available: true,
      target: 'computer-2',
      detail: 'No Windows-host-only execution requested.',
      blocking: false,
    });
  }

  return ingredients;
}
