import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function windmillMcpUrl() {
  const value = process.env.WINDMILL_MCP_URL?.trim();
  if (!value) throw new Error('WINDMILL_MCP_URL is not configured server-side');
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Windmill MCP must remain on the private local host');
  return url;
}

function parseToolText(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const record = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  const text = record.content?.find((item) => item.type === 'text')?.text || '';
  if (record.isError) throw new Error(text || 'Windmill MCP tool failed');
  if (!text) return result;
  try { return JSON.parse(text); } catch { return text; }
}

export async function callWindmill(tool: string, args: Record<string, unknown> = {}) {
  const client = new Client({ name: 'autonomous-project-builder', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(windmillMcpUrl());
  try {
    await client.connect(transport);
    return parseToolText(await client.callTool({ name: tool, arguments: args }));
  } finally {
    try { await client.close(); } catch {}
  }
}

export async function windmillJob(jobId: string) {
  return await callWindmill('getJob', { id: jobId, no_logs: true, no_code: true }) as Record<string, unknown>;
}

export async function cancelWindmillJob(jobId: string, reason = 'Cancelled by Autonomous Project Builder') {
  const mcp = windmillMcpUrl();
  const token = mcp.searchParams.get('token');
  if (!token) throw new Error('Windmill MCP credential is unavailable for job cancellation');
  const workspace = process.env.WINDMILL_WORKSPACE?.trim() || 'admins';
  const endpoint = new URL(`/api/w/${encodeURIComponent(workspace)}/jobs_u/queue/cancel/${encodeURIComponent(jobId)}`, mcp.origin);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Windmill cancellation failed with HTTP ${response.status}`);
  return true;
}

export function windmillConfigured() {
  try { windmillMcpUrl(); return true; } catch { return false; }
}