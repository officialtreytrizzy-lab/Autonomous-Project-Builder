import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import { replaceSource, tombstoneStoredSource } from '../../../../../../lib/intake/files.ts';
import { getIntakeStore, type IntakeStore } from '../../../../../../lib/intake/store.ts';

function ownedSource(store: IntakeStore, intakeId: string, sourceId: string) {
  return store.currentSources(intakeId).find((source) => source.sourceId === sourceId) || null;
}

export async function replaceOrDeleteSourceResponse(request: Request, intakeId: string, sourceId: string, store: IntakeStore) {
  const intake = store.getIntake(intakeId);
  const source = intake ? ownedSource(store, intakeId, sourceId) : null;
  if (!intake || !source) return Response.json({ error: 'Source not found' }, { status: 404 });
  if (request.method === 'DELETE') {
    const deleted = await tombstoneStoredSource(sourceId, store);
    return Response.json({ source: deleted, evidence_available: false });
  }
  try {
    const project = store.getProject(intake.projectId)!;
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'A replacement file is required' }, { status: 400 });
    const replacement = await replaceSource(sourceId, Readable.from(file.stream() as unknown as AsyncIterable<Uint8Array>), {
      filename: file.name, declaredMimeType: file.type, intakeId, projectWorkspace: project.workspace, store,
    });
    store.updateIntake(intakeId, { status: 'queued', planId: '', jobId: '' });
    if (project.state !== 'building') store.updateProject(project.id, { state: 'understanding' });
    store.appendEvent(project.id, {
      category: 'revision', stage: 'understanding', severity: 'warning', source: 'intake-api', target: 'computer-2',
      humanMessage: `Replaced ${source.originalFilename}; the affected Build Brief must be regenerated and approved.`,
      technicalPayload: { sourceId, revision: replacement.revision },
    });
    return Response.json({ source: replacement, approval_invalidated: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to replace source' }, { status: 400 });
  }
}

export async function GET(_request: Request, context: { params: Promise<{ intakeId: string; sourceId: string }> }) {
  const { intakeId, sourceId } = await context.params;
  const source = ownedSource(getIntakeStore(), intakeId, sourceId);
  if (!source || source.availability !== 'available') return Response.json({ error: 'Source evidence is unavailable' }, { status: 404 });
  return new Response(readFileSync(source.localPath), {
    headers: {
      'content-type': source.mimeType,
      'content-disposition': `inline; filename="${source.normalizedFilename.replaceAll('"', '')}"`,
      'cache-control': 'private, no-store',
    },
  });
}

export async function PUT(request: Request, context: { params: Promise<{ intakeId: string; sourceId: string }> }) {
  const { intakeId, sourceId } = await context.params;
  return replaceOrDeleteSourceResponse(request, intakeId, sourceId, getIntakeStore());
}

export async function DELETE(request: Request, context: { params: Promise<{ intakeId: string; sourceId: string }> }) {
  const { intakeId, sourceId } = await context.params;
  return replaceOrDeleteSourceResponse(request, intakeId, sourceId, getIntakeStore());
}
