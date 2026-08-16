import { NextRequest, NextResponse } from 'next/server';
import { getBuildStore } from '@/lib/build-store';

export async function GET(request: NextRequest) {
  const buildId = request.nextUrl.searchParams.get('build_id')?.trim();
  if (buildId) {
    const build = getBuildStore().get(buildId);
    return build ? NextResponse.json(build) : NextResponse.json({ error: 'Build not found' }, { status: 404 });
  }
  return NextResponse.json({ builds: getBuildStore().list(50) });
}
