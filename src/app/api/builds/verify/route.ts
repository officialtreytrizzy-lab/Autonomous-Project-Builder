import { NextRequest, NextResponse } from 'next/server';
import { getBuildService } from '@/lib/build-service';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { build_id?: string };
  const buildId = typeof body.build_id === 'string' ? body.build_id.trim() : '';
  if (!buildId) return NextResponse.json({ error: 'build_id is required' }, { status: 400 });
  try { return NextResponse.json(await getBuildService().rerunVerification(buildId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Verification rerun failed' }, { status: 502 }); }
}
