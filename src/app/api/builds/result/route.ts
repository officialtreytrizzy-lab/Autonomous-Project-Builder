import { NextRequest, NextResponse } from 'next/server';
import { getBuildService } from '@/lib/build-service';
import { getBuildStore } from '@/lib/build-store';

export async function GET(request: NextRequest) {
  const buildId = request.nextUrl.searchParams.get('build_id')?.trim();
  if (!buildId) return NextResponse.json({ error: 'build_id is required' }, { status: 400 });
  try {
    const build = await getBuildService().refresh(buildId);
    return NextResponse.json({ build, logs: getBuildStore().logs(buildId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Result check failed' }, { status: 502 });
  }
}
