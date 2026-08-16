import { z } from 'zod';

import { computeApprovalHash } from '../../../../../lib/intake/contract.ts';
import { getIntakeStore, type IntakeStore } from '../../../../../lib/intake/store.ts';
import { requirementContract, resolveRequirementStates } from '../../../../../lib/intake/requirements.ts';
import { BUILD_DELIVERABLES, BUILD_DEVICE_FAMILIES, BUILD_RUNTIMES, BUILD_TARGET_FAMILIES, defaultTarget, isValidBuildTarget } from '../../../../../lib/target-platform.ts';

const targetSchema = z.object({
  family: z.enum(BUILD_TARGET_FAMILIES),
  device: z.enum(BUILD_DEVICE_FAMILIES),
  runtime: z.enum(BUILD_RUNTIMES),
  deliverable: z.enum(BUILD_DELIVERABLES),
}).superRefine((value, context) => {
  if (!isValidBuildTarget(value)) context.addIssue({ code: 'custom', message: 'Unsupported build target combination' });
});

const schema = z.object({
  briefVersionId: z.string().min(1),
  buildConfiguration: z.object({
    repository: z.string().trim().max(300).default(''),
    backend: z.enum(['supabase', 'appwrite', 'firebase', 'none']).default('none'),
    deployment: z.enum(['local', 'vercel', 'none']).default('local'),
    workflow: z.enum(['windmill', 'none']).default('none'),
    needsAuthenticatedBrowser: z.boolean().default(false),
    needsWindowsHost: z.boolean().default(true),
    target: targetSchema.optional(),
  }).default({ repository: '', backend: 'none', deployment: 'local', workflow: 'none', needsAuthenticatedBrowser: false, needsWindowsHost: true }),
});

export async function approveIntakeResponse(request: Request, intakeId: string, store: IntakeStore) {
  try {
    const input = schema.parse(await request.json());
    const intake = store.getIntake(intakeId);
    if (!intake) return Response.json({ error: 'Intake not found' }, { status: 404 });
    const project = store.getProject(intake.projectId)!;
    const buildConfiguration = { ...input.buildConfiguration, target: input.buildConfiguration.target || project.buildTarget || defaultTarget() };
    const brief = store.currentBrief(intakeId);
    if (!brief || brief.id !== input.briefVersionId) return Response.json({ error: 'Only the current Build Brief can be approved' }, { status: 409 });
    if (!brief.visualCoverage.complete) return Response.json({ error: 'Every document page must be visually inspected before approval' }, { status: 409 });
    const decisions = store.decisionsForBrief(brief.id);
    if (decisions.some((decision) => decision.required && !decision.resolution.trim())) {
      return Response.json({ error: 'Resolve required evidence conflicts before approval' }, { status: 409 });
    }
    const requirementStates = resolveRequirementStates(store, intakeId);
    const missingInputs = requirementStates.filter((state) => state.requirement.required && !state.satisfied);
    if (missingInputs.length) return Response.json({ error: `Provide every required build input before approval: ${missingInputs.map((item) => item.requirement.label).join(', ')}` }, { status: 409 });
    const requirementMaterial = requirementContract(store, intakeId);
    const designSession = store.currentDesignSession(intakeId);
    const design = store.currentDesignContract(intakeId);
    if (!design || designSession?.status !== 'approved') {
      return Response.json({ error: 'Approve the visual design before authorizing the build' }, { status: 409 });
    }
    const sources = store.currentSources(intakeId);
    const hash = computeApprovalHash({ brief, sources, decisions, design, requirements: requirementMaterial, buildConfiguration });
    const approval = store.approve({
      projectId: project.id, intakeId, briefVersionId: brief.id, hash, buildConfiguration,
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
