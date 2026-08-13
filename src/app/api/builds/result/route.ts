import { NextRequest, NextResponse } from 'next/server';
import { callComputer2 } from '@/lib/computer2-mcp';

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('job_id')?.trim();
  if (!jobId) return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
  try { return NextResponse.json(await callComputer2('job_result', { job_id: jobId, full: request.nextUrl.searchParams.get('full') === '1' })); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Result check failed' }, { status: 502 }); }
}
