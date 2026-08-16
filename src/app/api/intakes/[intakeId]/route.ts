import { getIntakeStore } from '../../../../lib/intake/store.ts';
import { getIntakeService } from '../../../../lib/intake/service.ts';
import { resolveRequirementStates } from '../../../../lib/intake/requirements.ts';

export async function GET(request: Request, context: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await context.params;
  const store = getIntakeStore();
  let intake = store.getIntake(intakeId);
  if (!intake) return Response.json({ error: 'Intake not found' }, { status: 404 });
  const shouldReconcile = new URL(request.url).searchParams.get('reconcile') !== '0';
  if (shouldReconcile) {
    try { intake = await getIntakeService().reconcile(intakeId); } catch { intake = store.getIntake(intakeId)!; }
  }
  const sources = store.currentSources(intakeId).map(({ localPath: _localPath, intakeId: _id, ...source }) => source);
  const brief = store.currentBrief(intakeId);
  const decisions = brief ? store.decisionsForBrief(brief.id) : [];
  return Response.json({
    intake,
    sources,
    brief,
    decisions,
    requirements: resolveRequirementStates(store, intakeId),
    designSession: store.currentDesignSession(intakeId),
    design: store.currentDesignContract(intakeId),
    approval: store.currentApproval(intakeId),
  });
}
