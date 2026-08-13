import { NextResponse } from 'next/server';

type Probe = { ok: boolean; status: number | null; latencyMs: number; error?: string };

async function probe(url: string): Promise<Probe> {
  const started = Date.now();
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
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
  const [dockerGateway, windmill, computer2] = await Promise.all([
    probe(process.env.DOCKER_MCP_GATEWAY_HEALTH_URL || 'http://127.0.0.1:8811/mcp'),
    probe(process.env.WINDMILL_URL || 'http://127.0.0.1/'),
    probe(process.env.COMPUTER2_HEALTH_URL || 'http://127.0.0.1:3000/health/live'),
  ]);
  const ready = windmill.ok && computer2.ok;
  return NextResponse.json(
    { status: ready ? 'ready' : 'degraded', services: { dockerGateway, windmill, computer2 }, timestamp: new Date().toISOString() },
    { status: ready ? 200 : 207 },
  );
}
