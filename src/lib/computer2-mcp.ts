import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function required(name: 'COMPUTER2_MCP_URL' | 'BUILDER_SERVICE_TOKEN') {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function parseTextResult(result: unknown) {
  const value = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  const text = value.content?.find((item) => item.type === 'text')?.text ?? '';
  if (value.isError) throw new Error(text || 'Computer 2 MCP call failed');
  if (!text) return value;
  try { return JSON.parse(text); } catch { return { text }; }
}

export async function callComputer2(tool: string, args: Record<string, unknown> = {}) {
  const url = required('COMPUTER2_MCP_URL');
  const token = required('BUILDER_SERVICE_TOKEN');
  const client = new Client({ name: 'autonomous-project-builder', version: '0.2.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });

  await client.connect(transport);
  try {
    return parseTextResult(await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 120000 }));
  } finally {
    await client.close();
  }
}
