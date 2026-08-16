export type NeedleToolSchema = {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

export type NeedleRouteResult = {
  ok: boolean;
  type?: string;
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  candidateCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  confidence?: number | null;
  threshold?: number;
  schemaValid?: boolean;
  validationErrors?: string[];
  accepted: boolean;
  escalate: boolean;
  latencyMs?: number;
  metrics?: { prefillTps?: number; decodeTps?: number; peakRamMb?: number };
};

export function needleConfigured() {
  return Boolean(process.env.BUILDER_NEEDLE_ENDPOINT?.trim());
}

export async function routeWithNeedle(input: {
  query: string;
  tools: NeedleToolSchema[];
  system?: string;
  confidenceThreshold?: number;
}): Promise<NeedleRouteResult> {
  const endpoint = process.env.BUILDER_NEEDLE_ENDPOINT?.trim();
  if (!endpoint) return { ok: false, calls: [], accepted: false, escalate: true };
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => ({})) as Partial<NeedleRouteResult> & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Needle router failed with HTTP ${response.status}`);
  return {
    ok: payload.ok === true,
    calls: Array.isArray(payload.calls) ? payload.calls : [],
    candidateCalls: Array.isArray(payload.candidateCalls) ? payload.candidateCalls : [],
    confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
    threshold: typeof payload.threshold === 'number' ? payload.threshold : input.confidenceThreshold,
    schemaValid: payload.schemaValid === true,
    validationErrors: Array.isArray(payload.validationErrors) ? payload.validationErrors : [],
    accepted: payload.accepted === true,
    escalate: payload.escalate !== false,
    latencyMs: payload.latencyMs,
    metrics: payload.metrics,
    type: payload.type,
  };
}
