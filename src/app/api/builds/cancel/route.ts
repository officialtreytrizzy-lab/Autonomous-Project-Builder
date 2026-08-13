import { NextRequest, NextResponse } from 'next/server';
import { callComputer2 } from '@/lib/computer2-mcp';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : '';
  if (!jobId) return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
  try { return NextResponse.json(await callComputer2('job_cancel', { job_id: jobId })); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Cancel failed' }, { status: 502 }); }
}
