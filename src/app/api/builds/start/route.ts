import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBuildService } from '@/lib/build-service';

const schema = z.object({
  intake_id: z.string().trim().min(1),
  approval_hash: z.string().trim().length(64),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.parse(await request.json());
    const build = await getBuildService().startApproved({ intakeId: parsed.intake_id, approvalHash: parsed.approval_hash });
    return NextResponse.json({ ok: true, build, build_id: build.id, plan_id: build.planId, job_id: build.jobId, stage: build.status });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid build request', issues: error.issues }, { status: 400 });
    const failure = error as Error & { build?: { id?: string } };
    const status = /approval|required|no longer matches|visual inspection|decision/i.test(failure.message) ? 409 : 502;
    return NextResponse.json({ error: failure.message || 'Unable to start build', build_id: failure.build?.id }, { status });
  }
}
