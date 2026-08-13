import { NextRequest, NextResponse } from 'next/server';
import { getBuildStore } from '@/lib/build-store';
import { callComputer2 } from '@/lib/computer2-mcp';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { build_id?: string };
  const buildId = typeof body.build_id === 'string' ? body.build_id.trim() : '';
  const build = buildId ? getBuildStore().get(buildId) : null;
  if (!build) return NextResponse.json({ error: 'A valid build_id is required' }, { status: 404 });
  try {
    const result = await callComputer2('claude_invoke', { tool: 'vscode_open_folder', args: { path: build.workspace } });
    getBuildStore().appendLog(build.id, { step: 'open-project', target: 'computer-2', tool: 'vscode_open_folder', result: 'opened' });
    return NextResponse.json({ ok: true, workspace: build.workspace, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to open project', workspace: build.workspace }, { status: 502 });
  }
}
