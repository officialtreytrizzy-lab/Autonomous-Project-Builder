import { NextResponse } from 'next/server';
import { getBuildService } from '@/lib/build-service';

export async function POST() {
  try { return NextResponse.json({ ok: true, ...await getBuildService().resumeInterrupted() }); }
  catch { return NextResponse.json({ ok: false, degraded: true, errorClass: 'dependency-unavailable', message: 'Build recovery will retry when Computer 2 is available.' }); }
}
