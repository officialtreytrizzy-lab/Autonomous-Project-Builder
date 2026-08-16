import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, parse, resolve } from 'node:path';
import { z } from 'zod';

import { defaultProjectsRoot } from '../../../lib/build-store.ts';
import { getIntakeStore, type IntakeStore } from '../../../lib/intake/store.ts';
import { BUILD_DELIVERABLES, BUILD_DEVICE_FAMILIES, BUILD_RUNTIMES, BUILD_TARGET_FAMILIES, defaultTarget, isValidBuildTarget } from '../../../lib/target-platform.ts';

const buildTargetSchema = z.object({
  family: z.enum(BUILD_TARGET_FAMILIES),
  device: z.enum(BUILD_DEVICE_FAMILIES),
  runtime: z.enum(BUILD_RUNTIMES),
  deliverable: z.enum(BUILD_DELIVERABLES),
}).superRefine((value, context) => {
  if (!isValidBuildTarget(value)) context.addIssue({ code: 'custom', message: 'The selected device, runtime, and deliverable do not form a supported build target' });
});

const schema = z.object({
  name: z.string().trim().max(120).default(''),
  objective: z.string().trim().max(12000).default(''),
  repositoryRoot: z.string().trim().max(1000).default(''),
  inputMode: z.enum(['manual', 'implementation-plan']).default('manual'),
  implementationPlanFilename: z.string().trim().max(255).default(''),
  buildTarget: buildTargetSchema.default(defaultTarget()),
}).superRefine((value, context) => {
  if (value.inputMode === 'manual') {
    if (!value.name) context.addIssue({ code: 'custom', path: ['name'], message: 'Project name is required without an implementation plan' });
    if (!value.objective) context.addIssue({ code: 'custom', path: ['objective'], message: 'Project description is required without an implementation plan' });
    return;
  }
  if (!value.implementationPlanFilename) context.addIssue({ code: 'custom', path: ['implementationPlanFilename'], message: 'Implementation plan filename is required' });
  const extension = extname(value.implementationPlanFilename).toLowerCase();
  if (value.implementationPlanFilename && !['.pdf', '.doc', '.docx'].includes(extension)) context.addIssue({ code: 'custom', path: ['implementationPlanFilename'], message: 'Implementation plan must be a PDF, DOC, or DOCX file' });
});

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'project';
}

function importedPlanProjectName(filename: string) {
  const stem = basename(filename, extname(filename)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return stem.slice(0, 120) || 'Imported implementation plan';
}

const importedPlanObjective = 'Build the complete product defined by the imported implementation plan. Treat the implementation plan as authoritative and use any other uploaded files only as supporting context.';

function gitDirectory(workspace: string) {
  const marker = join(workspace, '.git');
  if (!existsSync(/*turbopackIgnore: true*/ marker)) return '';
  if (statSync(/*turbopackIgnore: true*/ marker).isDirectory()) return marker;
  if (!statSync(/*turbopackIgnore: true*/ marker).isFile()) return '';
  const match = readFileSync(/*turbopackIgnore: true*/ marker, 'utf8').match(/^gitdir:\s*(.+)\s*$/im);
  return match ? resolve(workspace, match[1]) : '';
}

function excludeBuilderControlFiles(workspace: string) {
  const gitDir = gitDirectory(workspace);
  if (!gitDir || !existsSync(/*turbopackIgnore: true*/ gitDir)) return;
  const info = join(gitDir, 'info');
  const exclude = join(info, 'exclude');
  mkdirSync(info, { recursive: true });
  const current = existsSync(/*turbopackIgnore: true*/ exclude) ? readFileSync(/*turbopackIgnore: true*/ exclude, 'utf8') : '';
  if (!current.split(/\r?\n/).some((line) => line.trim() === '.builder/')) {
    appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}.builder/\n`, 'utf8');
  }
}

export function resolveProjectWorkspace(input: { repositoryRoot?: string; projectsRoot: string; name: string }) {
  const selected = input.repositoryRoot?.trim() || '';
  if (selected) {
    if (!isAbsolute(selected)) throw new Error('Selected repository root must be an absolute local folder path');
    if (!existsSync(/*turbopackIgnore: true*/ selected) || !statSync(/*turbopackIgnore: true*/ selected).isDirectory()) throw new Error('Selected repository root no longer exists');
    accessSync(/*turbopackIgnore: true*/ selected, constants.R_OK | constants.W_OK);
    const workspace = realpathSync(/*turbopackIgnore: true*/ selected);
    if (parse(workspace).root.toLowerCase() === workspace.toLowerCase()) throw new Error('Select an app or repository folder, not an entire drive');
    excludeBuilderControlFiles(workspace);
    return { workspace, workspaceMode: 'existing' as const };
  }
  const root = resolve(input.projectsRoot);
  const workspace = resolve(root, `${slug(input.name)}-${crypto.randomUUID().slice(0, 8)}`);
  if (!workspace.startsWith(`${root}\\`) && workspace !== root) throw new Error('Invalid project workspace');
  return { workspace, workspaceMode: 'managed' as const };
}

export async function createProjectResponse(request: Request, deps: { store: IntakeStore; projectsRoot: string }) {
  try {
    const input = schema.parse(await request.json());
    const name = input.name || (input.inputMode === 'implementation-plan' ? importedPlanProjectName(input.implementationPlanFilename) : '');
    const objective = input.objective || (input.inputMode === 'implementation-plan' ? importedPlanObjective : '');
    const { workspace, workspaceMode } = resolveProjectWorkspace({ repositoryRoot: input.repositoryRoot, projectsRoot: deps.projectsRoot, name });
    mkdirSync(join(workspace, '.builder', 'intake-data', 'originals'), { recursive: true });
    const project = deps.store.createProject({ name, objective, workspace, workspaceMode, inputMode: input.inputMode, implementationPlanFilename: input.implementationPlanFilename, buildTarget: input.buildTarget });
    const intake = deps.store.createIntake(project.id);
    return Response.json({
      project_id: project.id,
      intake_id: intake.id,
      name: project.name,
      objective: project.objective,
      state: project.state,
      workspace_mode: project.workspaceMode,
      repository_name: workspaceMode === 'existing' ? basename(workspace) : '',
      build_target: project.buildTarget,
    }, { status: 201 });
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
