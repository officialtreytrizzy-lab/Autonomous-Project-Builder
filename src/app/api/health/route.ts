import { NextResponse } from 'next/server';
import { collectHealthReport } from '@/lib/health';

export async function GET() {
  const { services, readiness } = await collectHealthReport();

  return NextResponse.json(
    {
      status: readiness.status,
      architecture: 'hybrid-docker-mcp',
      core: ['computer2', 'localRuntime'],
      optional: ['dockerGateway', 'windmill', 'authenticatedChrome'],
      services,
      degradedCapabilities: readiness.degradedCapabilities,
      unavailableCore: readiness.unavailableCore,
      timestamp: new Date().toISOString(),
    },
    { status: readiness.ready ? 200 : 503 },
  );
}
