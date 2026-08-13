import { NextRequest, NextResponse } from 'next/server';
import { getBuildStore } from '@/lib/build-store';
import { callComputer2 } from '@/lib/computer2-mcp';
import { getIntakeStore } from '@/lib/intake/store';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { build_id?: string; project_id?: string; intake_id?: string };
  const buildId = typeof body.build_id === 'string' ? body.build_id.trim() : '';
  const build = buildId ? getBuildStore().get(buildId) : null;
  const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
  const intakeId = typeof body.intake_id === 'string' ? body.intake_id.trim() : '';
  const intake = intakeId ? getIntakeStore().getIntake(intakeId) : null;
  const project = projectId
    ? getIntakeStore().getProject(projectId)
    : intake
      ? getIntakeStore().getProject(intake.projectId)
      : null;
  const workspace = build?.workspace || project?.workspace || '';
  if (!workspace) return NextResponse.json({ error: 'A valid build_id, project_id, or intake_id is required' }, { status: 404 });
  try {
    const result = await callComputer2('claude_invoke', { tool: 'vscode_open_folder', args: { path: workspace } });
    if (build) getBuildStore().appendLog(build.id, { step: 'open-project', target: 'computer-2', tool: 'vscode_open_folder', result: 'opened' });
    return NextResponse.json({ ok: true, workspace, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to open project' }, { status: 502 });
  }
}
