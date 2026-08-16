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


type GeminiVisionProbeCache = { key: string; expiresAt: number; result: ServiceProbe };
let geminiVisionProbeCache: GeminiVisionProbeCache | null = null;
const GEMINI_VISION_PROBE_TTL_MS = 10 * 60 * 1000;
const GEMINI_VISION_PROBE_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export async function probeGeminiDocumentVision(options: {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  now?: number;
  cache?: boolean;
} = {}): Promise<ServiceProbe> {
  const apiKey = options.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || '';
  const model = options.model?.trim() || process.env.BUILDER_VISION_MODEL?.trim() || 'gemini-3.7-flash';
  if (!apiKey) return { ok: false, detail: 'Gemini API document vision needs GEMINI_API_KEY.' };
  const now = options.now ?? Date.now();
  const cacheKey = `${model}:${apiKey.slice(-8)}`;
  if (options.cache !== false && geminiVisionProbeCache?.key === cacheKey && geminiVisionProbeCache.expiresAt > now) {
    return geminiVisionProbeCache.result;
  }
  const started = Date.now();
  let result: ServiceProbe;
  try {
    const response = await (options.fetchImpl || fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { text: 'Vision health check. Return only OK.' },
            { inlineData: { mimeType: 'image/png', data: GEMINI_VISION_PROBE_PIXEL } },
          ] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8 },
        }),
      },
    );
    if (response.ok) {
      result = { ok: true, status: response.status, latencyMs: Date.now() - started, detail: `Gemini API document vision ready (${model}).` };
    } else {
      let message = '';
      try {
        const payload = await response.json() as { error?: { message?: string } };
        message = payload.error?.message || '';
      } catch {}
      const normalized = message.toLowerCase();
      const detail = normalized.includes('prepayment credits are depleted')
        ? `Gemini API document vision is configured, but prepayment credits are depleted (${model}).`
        : response.status === 429
          ? `Gemini API document vision is rate or quota limited (${model}).`
          : response.status === 503
            ? `Gemini API document vision is temporarily at capacity (${model}).`
            : `Gemini API document vision probe failed with HTTP ${response.status} (${model}).`;
      result = { ok: false, status: response.status, latencyMs: Date.now() - started, detail };
    }
  } catch (error) {
    result = { ok: false, status: null, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error), detail: `Gemini API document vision could not be reached (${model}).` };
  }
  if (options.cache !== false) geminiVisionProbeCache = { key: cacheKey, expiresAt: now + GEMINI_VISION_PROBE_TTL_MS, result };
  return result;
}

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
  const computer2Url = process.env.COMPUTER2_HEALTH_URL || 'http://127.0.0.1:3000/health/deep';
  const gatewayUrl = process.env.DOCKER_MCP_GATEWAY_HEALTH_URL || 'http://127.0.0.1:8811/health';
  const gatewayToken = process.env.DOCKER_MCP_GATEWAY_TOKEN?.trim() || process.env.MCP_GATEWAY_AUTH_TOKEN?.trim();
  const [{ computer2, authenticatedChrome }, dockerGateway, windmill, documentVision] = await Promise.all([
    probeComputer2AndChrome(computer2Url),
    probeService(gatewayUrl, gatewayUrl.endsWith('/mcp') ? { bearerToken: gatewayToken } : {}),
    probeService(process.env.WINDMILL_URL || 'http://127.0.0.1/'),
    probeGeminiDocumentVision(),
  ]);
  const services = {
    computer2,
    localRuntime: { ok: true, status: 200, latencyMs: 0, detail: 'Builder server is responding on its private local runtime.' },
    dockerGateway,
    windmill,
    authenticatedChrome,
    documentVision,
  };
  return { services, readiness: summarizeReadiness(services) };
}
