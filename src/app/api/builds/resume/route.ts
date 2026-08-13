import { NextResponse } from 'next/server';
import { getBuildService } from '@/lib/build-service';

export async function POST() {
  try { return NextResponse.json(await getBuildService().resumeInterrupted()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Resume failed' }, { status: 502 }); }
}
