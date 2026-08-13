import { NextRequest, NextResponse } from 'next/server';
import { callComputer2 } from '@/lib/computer2-mcp';
import { getPersistedBuild, persistBuild } from '@/lib/supabase-store';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : '';
  const buildId = typeof body.build_id === 'string' ? body.build_id.trim() : '';
  if (!jobId) return NextResponse.json({ error: 'job_id is required' }, { status: 400 });

  try {
    const result = await callComputer2('job_cancel', { job_id: jobId });

    // Update persistence store with cancelled status
    if (buildId) {
      const existing = await getPersistedBuild(buildId).catch(() => null);
      if (existing) {
        await persistBuild({
          id: existing.id,
          request: {
            name: existing.name,
            objective: existing.objective,
            repository: existing.repository,
            backend: existing.backend as 'supabase' | 'appwrite' | 'firebase' | 'none',
            deployment: existing.deployment as 'local' | 'vercel' | 'none',
            workflow: existing.workflow as 'windmill' | 'none',
          },
          analysis: {
            request: {},
            ingredients: existing.ingredients as [],
            steps: existing.steps as [],
            stage: 'failed',
            blockingCount: 0,
            greenCount: 0,
            yellowCount: 0,
            redCount: 0,
            canContinue: false,
          },
          planId: existing.planId,
          jobId: existing.jobId,
          status: 'cancelled',
          logs: [
            ...(existing.logs as unknown[] || []),
            { time: new Date().toISOString(), message: 'Build cancelled by user request.' },
          ],
        }).catch(() => {});
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Cancel failed' }, { status: 502 });
  }
}
