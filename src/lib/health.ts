export type ServiceProbe = {
  ok: boolean;
  status?: number | null;
  latencyMs?: number;
  error?: string;
  detail?: string;
};

type ProbeOptions = {
  bearerToken?: string;
  timeoutMs?: number;
  acceptedStatuses?: number[];
};

export async function probeService(url: string, options: ProbeOptions = {}): Promise<ServiceProbe> {
  const started = Date.now();
  try {
    const headers: HeadersInit = {};
    if (options.bearerToken) headers.authorization = `Bearer ${options.bearerToken}`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
    const accepted = options.acceptedStatuses ?? [];
    return {
      ok: response.ok || accepted.includes(response.status),
      status: response.status,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const CORE_CAPABILITIES = ['computer2', 'localRuntime'] as const;

export function summarizeReadiness(services: Record<string, ServiceProbe>, requiredCapabilities: string[] = []) {
  const unavailableCore = CORE_CAPABILITIES.filter((name) => !services[name]?.ok);
  const unavailableRequired = requiredCapabilities.filter((name) => !services[name]?.ok);
  const degradedCapabilities = Object.entries(services)
    .filter(([name, service]) => !CORE_CAPABILITIES.includes(name as (typeof CORE_CAPABILITIES)[number]) && !requiredCapabilities.includes(name) && !service.ok)
    .map(([name]) => name);
  const ready = unavailableCore.length === 0 && unavailableRequired.length === 0;
  return { ready, status: ready ? 'ready' as const : 'unavailable' as const, unavailableCore, unavailableRequired, degradedCapabilities };
}

async function probeComputer2AndChrome(url: string): Promise<{ computer2: ServiceProbe; authenticatedChrome: ServiceProbe }> {
  const computer2 = await probeService(url);
  if (!computer2.ok) return { computer2, authenticatedChrome: { ok: false, error: 'Computer 2 is unavailable' } };
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const payload = await response.json() as { authenticatedChromeBridge?: { extensionConnected?: boolean; browserResponsive?: boolean; connectedProfiles?: number } };
    const chrome = payload.authenticatedChromeBridge;
    return {
      computer2,
      authenticatedChrome: {
        ok: Boolean(chrome?.extensionConnected && chrome?.browserResponsive),
        status: response.status,
        detail: chrome ? `${chrome.connectedProfiles ?? 0} signed-in profile(s) connected` : 'Bridge status unavailable',
      },
    };
  } catch (error) {
    return { computer2, authenticatedChrome: { ok: false, error: error instanceof Error ? error.message : String(error) } };
  }
}

export async function collectHealthReport() {
  const { discoverDocumentCapabilities } = await import('./intake/capabilities');
  const computer2Url = process.env.COMPUTER2_HEALTH_URL || 'http://127.0.0.1:3000/health/deep';
  const gatewayUrl = process.env.DOCKER_MCP_GATEWAY_HEALTH_URL || 'http://127.0.0.1:8811/health';
  const gatewayToken = process.env.DOCKER_MCP_GATEWAY_TOKEN?.trim() || process.env.MCP_GATEWAY_AUTH_TOKEN?.trim();
  const [{ computer2, authenticatedChrome }, dockerGateway, windmill, documentCapabilities] = await Promise.all([
    probeComputer2AndChrome(computer2Url),
    probeService(gatewayUrl, gatewayUrl.endsWith('/mcp') ? { bearerToken: gatewayToken } : {}),
    probeService(process.env.WINDMILL_URL || 'http://127.0.0.1/'),
    discoverDocumentCapabilities(),
  ]);
  const services = {
    computer2,
    localRuntime: { ok: true, status: 200, latencyMs: 0, detail: 'Builder server is responding on its private local runtime.' },
    dockerGateway,
    windmill,
    authenticatedChrome,
    documentVision: {
      ok: documentCapabilities.vision.available,
      detail: documentCapabilities.vision.detail,
    },
  };
  return { services, readiness: summarizeReadiness(services) };
}
