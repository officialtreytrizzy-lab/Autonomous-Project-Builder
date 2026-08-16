import { extname } from 'node:path';
import { Readable } from 'node:stream';

import { storeSource } from '../../../../../lib/intake/files.ts';
import { getIntakeStore, type IntakeStore } from '../../../../../lib/intake/store.ts';

function streamFile(file: File) {
  return Readable.from(file.stream() as unknown as AsyncIterable<Uint8Array>);
}

export async function uploadSourceResponse(request: Request, intakeId: string, store: IntakeStore) {
  try {
    const intake = store.getIntake(intakeId);
    if (!intake) return Response.json({ error: 'Intake not found' }, { status: 404 });
    const project = store.getProject(intake.projectId);
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'A source file is required' }, { status: 400 });
    const rawRole = String(form.get('role') || 'reference');
    if (!['reference', 'implementation-plan'].includes(rawRole)) return Response.json({ error: 'Invalid source role' }, { status: 400 });
    const role = rawRole as 'reference' | 'implementation-plan';
    if (role === 'implementation-plan') {
      if (!['.pdf', '.doc', '.docx'].includes(extname(file.name).toLowerCase())) return Response.json({ error: 'Implementation plans must be PDF, DOC, or DOCX files' }, { status: 400 });
      if (store.currentSources(intakeId).some((item) => item.availability === 'available' && item.role === 'implementation-plan')) return Response.json({ error: 'This project already has an implementation plan. Replace the current plan instead.' }, { status: 400 });
    }
    const source = await storeSource(streamFile(file), {
      filename: file.name,
      declaredMimeType: file.type,
      intakeId,
      projectWorkspace: project.workspace,
      store,
      role,
    });
    store.updateIntake(intakeId, { status: 'draft', planId: '', jobId: '' });
    if (project.state !== 'building') store.updateProject(project.id, { state: 'draft' });
    return Response.json({ source }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to store source' }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await context.params;
  return uploadSourceResponse(request, intakeId, getIntakeStore());
}
