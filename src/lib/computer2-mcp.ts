import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export function getComputer2Url() {
  return process.env.COMPUTER2_MCP_URL?.trim() || process.env.MCP_MAIN_NODE_URL?.trim() || 'http://127.0.0.1:3000/mcp';
}

function getServiceToken() {
  const value = process.env.BUILDER_SERVICE_TOKEN?.trim() || process.env.MCP_AUTH_TOKEN?.trim();
  if (!value) throw new Error('Computer 2 MCP service token is not configured');
  return value;
}

function parseLeadingJson(text: string) {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;
  const opening = text[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === opening) depth += 1;
    if (character === closing) depth -= 1;
    if (depth === 0) {
      try { return JSON.parse(text.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
}

export function parseComputer2Result(result: unknown) {
  const value = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  const text = value.content?.find((item) => item.type === 'text')?.text ?? '';
  if (value.isError) throw new Error(text || 'Computer 2 MCP call failed');
  if (!text) return value;
  try { return JSON.parse(text); } catch { return parseLeadingJson(text) ?? { text }; }
}

export async function callComputer2(tool: string, args: Record<string, unknown> = {}) {
  const url = getComputer2Url();
  const token = getServiceToken();
  const client = new Client({ name: 'autonomous-project-builder', version: '0.2.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });

  await client.connect(transport);
  try {
    return parseComputer2Result(await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 120000 }));
  } finally {
    await client.close();
  }
}
