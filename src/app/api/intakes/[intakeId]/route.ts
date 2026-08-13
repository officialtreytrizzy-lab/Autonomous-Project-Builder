import { getIntakeStore } from '../../../../lib/intake/store.ts';

export async function GET(_request: Request, context: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await context.params;
  const store = getIntakeStore();
  const intake = store.getIntake(intakeId);
  if (!intake) return Response.json({ error: 'Intake not found' }, { status: 404 });
  const sources = store.currentSources(intakeId).map(({ localPath: _localPath, intakeId: _id, ...source }) => source);
  const brief = store.currentBrief(intakeId);
  const decisions = brief ? store.decisionsForBrief(brief.id) : [];
  return Response.json({ intake, sources, brief, decisions, approval: store.currentApproval(intakeId) });
}
