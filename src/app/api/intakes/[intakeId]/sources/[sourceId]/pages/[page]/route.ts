import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getIntakeStore } from '../../../../../../../../lib/intake/store.ts';

export async function GET(_request: Request, context: { params: Promise<{ intakeId: string; sourceId: string; page: string }> }) {
  const { intakeId, sourceId, page: pageValue } = await context.params;
  const page = Number(pageValue);
  if (!Number.isInteger(page) || page < 1) return Response.json({ error: 'Invalid page' }, { status: 400 });
  const store = getIntakeStore();
  const source = store.currentSources(intakeId).find((item) => item.sourceId === sourceId);
  if (!source) return Response.json({ error: 'Source not found' }, { status: 404 });
  const evidence = store.evidenceForBriefSource(intakeId, sourceId).find((item) => item.page === page && item.artifactPath);
  if (!evidence?.artifactPath) return Response.json({ error: 'Rendered page is unavailable' }, { status: 404 });
  const artifact = resolve(evidence.artifactPath);
  const allowedRoot = resolve(source.localPath, '..', '..', 'derived');
  if (!artifact.startsWith(`${allowedRoot}\\`)) return Response.json({ error: 'Invalid evidence path' }, { status: 403 });
  return new Response(readFileSync(artifact), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } });
}
