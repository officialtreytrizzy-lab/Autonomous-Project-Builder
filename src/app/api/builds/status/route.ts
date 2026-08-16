import { NextRequest, NextResponse } from 'next/server';
import { getBuildService } from '@/lib/build-service';
import { getBuildStore } from '@/lib/build-store';

export async function GET(request: NextRequest) {
  const buildId = request.nextUrl.searchParams.get('build_id')?.trim();
  const jobId = request.nextUrl.searchParams.get('job_id')?.trim();
  const build = buildId ? getBuildStore().get(buildId) : jobId ? getBuildStore().findByJobId(jobId) : null;
  if (!build) return NextResponse.json({ error: 'A valid build_id or job_id is required' }, { status: 404 });
  try { return NextResponse.json(await getBuildService().refresh(build.id)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Status check failed' }, { status: 502 }); }
}
