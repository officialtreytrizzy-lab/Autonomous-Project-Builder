import { getIntakeStore } from '../../../../../lib/intake/store.ts';

export async function GET(_request: Request, context: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await context.params;
  const store = getIntakeStore();
  const brief = store.currentBrief(intakeId);
  if (!brief) return Response.json({ error: 'Build Brief is not ready' }, { status: 404 });
  const citations = store.evidenceForIntake(intakeId).map((evidence) => ({
    evidenceId: evidence.evidenceId,
    sourceId: evidence.sourceId,
    revisionId: evidence.revisionId,
    page: evidence.page,
    region: evidence.region,
    kind: evidence.kind,
    content: evidence.content,
    relationships: evidence.relationships,
    confidence: evidence.confidence,
    artifactAvailable: Boolean(evidence.artifactPath),
  }));
  return Response.json({ ...brief, decisions: store.decisionsForBrief(brief.id), citations });
}
