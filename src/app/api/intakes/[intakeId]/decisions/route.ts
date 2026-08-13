import { z } from 'zod';
import { getIntakeStore } from '../../../../../lib/intake/store.ts';

const schema = z.object({ decisionId: z.string().min(1), resolution: z.string().trim().min(1).max(4000) });

export async function GET(_request: Request, context: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await context.params;
  const store = getIntakeStore();
  const brief = store.currentBrief(intakeId);
  return Response.json({ decisions: brief ? store.decisionsForBrief(brief.id) : [] });
}

export async function POST(request: Request, context: { params: Promise<{ intakeId: string }> }) {
  try {
    const { intakeId } = await context.params;
    const store = getIntakeStore();
    const brief = store.currentBrief(intakeId);
    if (!brief) return Response.json({ error: 'Build Brief not found' }, { status: 404 });
    const input = schema.parse(await request.json());
    if (!store.decisionsForBrief(brief.id).some((decision) => decision.decisionId === input.decisionId)) {
      return Response.json({ error: 'Decision does not belong to the current Build Brief' }, { status: 404 });
    }
    const decision = store.resolveDecision(input.decisionId, input.resolution);
    const remaining = store.decisionsForBrief(brief.id).filter((item) => item.required && !item.resolution.trim()).length;
    if (remaining === 0) store.updateIntake(intakeId, { status: 'awaiting-approval' });
    return Response.json({ decision, remaining_required: remaining });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Invalid decision', issues: error.issues }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to resolve decision' }, { status: 400 });
  }
}
