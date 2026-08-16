import { z } from 'zod';

import { getIntakeStore, type IntakeStore } from '../../../../../../lib/intake/store.ts';
import { confirmRequirement, fulfillRequirementCredential, fulfillRequirementPaths, fulfillRequirementValue } from '../../../../../../lib/intake/requirements.ts';
import { getSecureVault, type SecureVault } from '../../../../../../lib/secure-vault.ts';

const schema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('paths'), paths: z.array(z.string().trim().min(1)).min(1).max(1000) }),
  z.object({ mode: z.literal('credential'), fields: z.record(z.string().min(1), z.string().max(20_000)) }),
  z.object({ mode: z.literal('value'), value: z.string().max(100_000) }),
  z.object({ mode: z.literal('confirm'), note: z.string().max(10_000).optional() }),
]);

export async function fulfillRequirementResponse(
  request: Request,
  intakeId: string,
  requirementId: string,
  deps: { store: IntakeStore; vault?: SecureVault },
) {
  try {
    const intake = deps.store.getIntake(intakeId);
    if (!intake) return Response.json({ error: 'Intake not found' }, { status: 404 });
    const input = schema.parse(await request.json());
    let state;
    if (input.mode === 'paths') state = await fulfillRequirementPaths({ store: deps.store, intakeId, requirementId, paths: input.paths });
    else if (input.mode === 'credential') state = await fulfillRequirementCredential({ store: deps.store, intakeId, requirementId, fields: input.fields, vault: deps.vault || getSecureVault() });
    else if (input.mode === 'value') state = fulfillRequirementValue({ store: deps.store, intakeId, requirementId, value: input.value });
    else state = confirmRequirement({ store: deps.store, intakeId, requirementId, note: input.note });

    deps.store.updateIntake(intakeId, { status: 'awaiting-approval' });
    deps.store.updateProject(intake.projectId, { state: 'awaiting-approval' });
    deps.store.appendEvent(intake.projectId, {
      category: 'required-input', stage: 'understanding', severity: 'success', source: 'intake-api', target: 'user',
      humanMessage: `Provided required build input: ${state.requirement.label}.`,
      technicalPayload: { requirementId, kind: state.requirement.kind, source: state.source, satisfied: state.satisfied, fileCount: state.fileCount || 0 },
    });
    return Response.json({ requirement: state });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Invalid required-input request', issues: error.issues }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to save required build input' }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ intakeId: string; requirementId: string }> }) {
  const { intakeId, requirementId } = await context.params;
  return fulfillRequirementResponse(request, intakeId, requirementId, { store: getIntakeStore() });
}
