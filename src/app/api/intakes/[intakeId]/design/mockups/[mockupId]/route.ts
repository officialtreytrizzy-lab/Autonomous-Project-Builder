import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { getIntakeStore } from '../../../../../../../lib/intake/store.ts';

export async function GET(_request: Request, context: { params: Promise<{ intakeId: string; mockupId: string }> }) {
  const { intakeId, mockupId } = await context.params;
  const store = getIntakeStore();
  const intake = store.getIntake(intakeId);
  if (!intake) return Response.json({ error: 'Intake not found' }, { status: 404 });
  const session = store.currentDesignSession(intakeId);
  const contract = store.currentDesignContract(intakeId);
  const mockup = [...(session?.mockups || []), ...(contract?.mockups || [])].find((item) => item.mockupId === mockupId);
  if (!mockup) return Response.json({ error: 'Design mockup not found' }, { status: 404 });
  const project = store.getProject(intake.projectId);
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });
  const allowedRoot = resolve(project.workspace, '.builder', 'design-mockups', intakeId);
  const imagePath = resolve(allowedRoot, mockup.fileName);
  if (imagePath !== allowedRoot && !imagePath.startsWith(`${allowedRoot}${sep}`)) {
    return Response.json({ error: 'Invalid mockup path' }, { status: 403 });
  }
  try {
    return new Response(readFileSync(imagePath), {
      headers: {
        'content-type': mockup.mimeType || 'image/png',
        'cache-control': 'private, no-store',
      },
    });
  } catch {
    return Response.json({ error: 'Design mockup file is unavailable' }, { status: 404 });
  }
}