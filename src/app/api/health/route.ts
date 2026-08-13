import { NextResponse } from 'next/server';

type Probe = { ok: boolean; status: number | null; latencyMs: number; error?: string };

async function probe(url: string): Promise<Probe> {
  const started = Date.now();
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    return { ok: response.ok, status: response.status, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  const computer2Url = process.env.COMPUTER2_HEALTH_URL;
  const isHosted = Boolean(process.env.VERCEL);

  const computer2 = computer2Url
    ? await probe(computer2Url)
    : isHosted
      ? { ok: false, status: null, latencyMs: 0, error: 'COMPUTER2_HEALTH_URL is not configured' }
      : await probe('http://127.0.0.1:3000/health/deep');

  const dockerGateway = isHosted
    ? { ok: computer2.ok, status: computer2.status, latencyMs: computer2.latencyMs, delegatedThrough: 'computer2' }
    : await probe(process.env.DOCKER_MCP_GATEWAY_HEALTH_URL || 'http://127.0.0.1:8811/mcp');

  const windmill = isHosted
    ? { ok: computer2.ok, status: computer2.status, latencyMs: computer2.latencyMs, delegatedThrough: 'computer2' }
    : await probe(process.env.WINDMILL_URL || 'http://127.0.0.1/');

  const ready = computer2.ok && dockerGateway.ok && windmill.ok;

  return NextResponse.json(
    {
      status: ready ? 'ready' : 'degraded',
      computer2: computer2.ok,
      dockerGateway: dockerGateway.ok,
      windmill: windmill.ok,
      architecture: 'hybrid-docker-mcp',
      services: { computer2, dockerGateway, windmill },
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 207 },
  );
}
