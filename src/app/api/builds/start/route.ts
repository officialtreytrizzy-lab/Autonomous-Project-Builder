import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBuildService } from '@/lib/build-service';
import { analyzeBuild, applyCapabilityHealth } from '@/lib/builder';
import { collectHealthReport } from '@/lib/health';

const schema = z.object({
  name: z.string().trim().max(120).optional(),
  objective: z.string().trim().min(1).max(12000),
  repository: z.string().trim().max(300).optional(),
  backend: z.enum(['supabase', 'appwrite', 'firebase', 'none']).default('none'),
  deployment: z.enum(['local', 'vercel', 'none']).default('local'),
  workflow: z.enum(['windmill', 'none']).default('none'),
  needsAuthenticatedBrowser: z.boolean().default(false),
  needsWindowsHost: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.parse(await request.json());
    const { services } = await collectHealthReport();
    const liveAnalysis = applyCapabilityHealth(analyzeBuild(parsed), {
      computer2: services.computer2.ok,
      dockerGateway: services.dockerGateway.ok,
      windmill: services.windmill.ok,
      authenticatedChrome: services.authenticatedChrome.ok,
    });
    if (!liveAnalysis.canContinue) return NextResponse.json({ error: 'Build has a genuinely blocking RED dependency', analysis: liveAnalysis }, { status: 409 });
    const build = await getBuildService().start(parsed);
    return NextResponse.json({ ok: true, build, build_id: build.id, plan_id: build.planId, job_id: build.jobId, stage: build.status });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid build request', issues: error.issues }, { status: 400 });
    const failure = error as Error & { build?: { id?: string } };
    return NextResponse.json({ error: failure.message || 'Unable to start build', build_id: failure.build?.id }, { status: 502 });
  }
}
