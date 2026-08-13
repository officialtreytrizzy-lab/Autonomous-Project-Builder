import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

import { defaultProjectsRoot } from '../../../lib/build-store.ts';
import { getIntakeStore, type IntakeStore } from '../../../lib/intake/store.ts';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(1).max(12000),
});

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'project';
}

export async function createProjectResponse(request: Request, deps: { store: IntakeStore; projectsRoot: string }) {
  try {
    const input = schema.parse(await request.json());
    const root = resolve(deps.projectsRoot);
    const workspace = resolve(root, `${slug(input.name)}-${crypto.randomUUID().slice(0, 8)}`);
    if (!workspace.startsWith(`${root}\\`) && workspace !== root) return Response.json({ error: 'Invalid project workspace' }, { status: 400 });
    mkdirSync(join(workspace, 'intake', 'originals'), { recursive: true });
    const project = deps.store.createProject({ ...input, workspace });
    const intake = deps.store.createIntake(project.id);
    return Response.json({ project_id: project.id, intake_id: intake.id, name: project.name, objective: project.objective, state: project.state, workspace }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Invalid project request', issues: error.issues }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to create project' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return createProjectResponse(request, { store: getIntakeStore(), projectsRoot: defaultProjectsRoot() });
}

export async function GET() {
  const projects = getIntakeStore().allProjects().map(({ workspace: _workspace, ...project }) => project);
  return Response.json({ projects });
}
