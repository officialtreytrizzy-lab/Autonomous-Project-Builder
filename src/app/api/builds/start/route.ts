import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeBuild, APPROVAL_CONTINUATION_POLICY } from '@/lib/builder';
import { callComputer2 } from '@/lib/computer2-mcp';

const schema = z.object({
  name: z.string().trim().max(120).optional(),
  objective: z.string().trim().min(1).max(4000),
  repository: z.string().trim().min(1).max(300),
  backend: z.enum(['supabase', 'appwrite', 'firebase', 'none']).default('none'),
  deployment: z.enum(['vercel', 'none']).default('none'),
  workflow: z.enum(['windmill', 'none']).default('none'),
  needsAuthenticatedBrowser: z.boolean().default(false),
  needsWindowsHost: z.boolean().default(false),
});

function pickId(value: unknown, names: string[]) {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const name of names) if (typeof record[name] === 'string' && record[name]) return String(record[name]);
  return '';
}

export async function POST(request: NextRequest) {
  try {
    const buildRequest = schema.parse(await request.json());
    const analysis = analyzeBuild(buildRequest);
    if (!analysis.canContinue) {
      return NextResponse.json({ error: 'Build has a true blocking dependency', analysis }, { status: 409 });
    }

    const goal = [
      `Project: ${buildRequest.name || buildRequest.repository}`,
      `Objective: ${buildRequest.objective}`,
      `Repository: ${buildRequest.repository}`,
      `Operating rule: ${APPROVAL_CONTINUATION_POLICY}`,
      'Inspect resources before recommending purchases or new accounts.',
      'Use Docker MCP for portable service integrations, Computer 2 for host-native/authenticated Chrome work, and Windmill for durable long-running orchestration.',
      'Run regression and production verification before declaring completion.',
    ].join('\n');

    const plan = await callComputer2('claude_invoke', {
      tool: 'plan_create',
      args: { goal, context: { source: 'autonomous-project-builder', request: buildRequest, executionPlan: analysis.steps } },
    });
    const planId = pickId(plan, ['plan_id', 'planId', 'id']);
    if (!planId) throw new Error('Computer 2 did not return a plan id');

    const job = await callComputer2('job_submit', { tool: 'plan_execute', arguments: { plan_id: planId } });
    const jobId = pickId(job, ['job_id', 'jobId', 'id']);
    if (!jobId) throw new Error('Computer 2 did not return a job id');

    return NextResponse.json({ ok: true, plan_id: planId, job_id: jobId, stage: 'running', analysis });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid build request', issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to start build' }, { status: 502 });
  }
}
