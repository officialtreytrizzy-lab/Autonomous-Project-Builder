import { NextRequest, NextResponse } from 'next/server';
import { callComputer2 } from '@/lib/computer2-mcp';
import { runProductionVerification } from '@/lib/verifier';

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('job_id')?.trim();
  if (!jobId) return NextResponse.json({ error: 'job_id is required' }, { status: 400 });

  try {
    const result = await callComputer2('job_result', {
      job_id: jobId,
      full: request.nextUrl.searchParams.get('full') === '1',
    });

    // Gap 11: Run server-side verification before returning completed result
    let verification = null;
    try {
      verification = await runProductionVerification({
        skipTests: true,
        runBuildCheck: false,
      });
    } catch {
      // Verification failure is non-blocking for result retrieval
    }

    return NextResponse.json({
      ...result,
      verification: verification
        ? {
            ok: verification.ok,
            totalChecks: verification.totalChecks,
            passedChecks: verification.passedChecks,
            failedChecks: verification.failedChecks,
            repairAttempts: verification.repairAttempts,
            summary: verification.summary,
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Result check failed' },
      { status: 502 },
    );
  }
}
