import { z } from 'zod';

import { computeApprovalHash } from '../../../../../lib/intake/contract.ts';
import { getIntakeStore, type IntakeStore } from '../../../../../lib/intake/store.ts';

const schema = z.object({
  briefVersionId: z.string().min(1),
  buildConfiguration: z.object({
    repository: z.string().trim().max(300).default(''),
    backend: z.enum(['supabase', 'appwrite', 'firebase', 'none']).default('none'),
    deployment: z.enum(['local', 'vercel', 'none']).default('local'),
    workflow: z.enum(['windmill', 'none']).default('none'),
    needsAuthenticatedBrowser: z.boolean().default(false),
    needsWindowsHost: z.boolean().default(true),
  }).default({ repository: '', backend: 'none', deployment: 'local', workflow: 'none', needsAuthenticatedBrowser: false, needsWindowsHost: true }),
});

export async function approveIntakeResponse(request: Request, intakeId: string, store: IntakeStore) {
  try {
    const input = schema.parse(await request.json());
    const intake = store.getIntake(intakeId);
    if (!intake) return Response.json({ error: 'Intake not found' }, { status: 404 });
    const project = store.getProject(intake.projectId)!;
    const brief = store.currentBrief(intakeId);
    if (!brief || brief.id !== input.briefVersionId) return Response.json({ error: 'Only the current Build Brief can be approved' }, { status: 409 });
    if (!brief.visualCoverage.complete) return Response.json({ error: 'Every document page must be visually inspected before approval' }, { status: 409 });
    const decisions = store.decisionsForBrief(brief.id);
    if (decisions.some((decision) => decision.required && !decision.resolution.trim())) {
      return Response.json({ error: 'Resolve required evidence conflicts before approval' }, { status: 409 });
    }
    const sources = store.currentSources(intakeId);
    const hash = computeApprovalHash({ brief, sources, decisions, buildConfiguration: input.buildConfiguration });
    const approval = store.approve({
      projectId: project.id, intakeId, briefVersionId: brief.id, hash, buildConfiguration: input.buildConfiguration,
    });
    store.appendEvent(project.id, {
      category: 'approved', stage: 'approval', severity: 'success', source: 'intake-api', target: 'user',
      humanMessage: 'Approved the immutable Build Brief and authorized autonomous execution.', technicalPayload: { briefVersionId: brief.id, approvalHash: hash },
    });
    return Response.json({ approval, approval_hash: hash });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Invalid approval request', issues: error.issues }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to approve intake' }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await context.params;
  return approveIntakeResponse(request, intakeId, getIntakeStore());
}
