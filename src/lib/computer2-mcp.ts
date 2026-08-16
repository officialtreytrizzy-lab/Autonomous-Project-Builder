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

type Computer2Client = Pick<Client, 'connect' | 'callTool' | 'close'>;

function isExpiredSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:unknown|expired|invalid|no\s+valid)[^\r\n]{0,80}session\s*id|session\s*id[^\r\n]{0,80}(?:unknown|expired|invalid|no\s+valid)/i.test(message);
}
export function createComputer2Caller(options: {
  url: string;
  token: string;
  createClient?: () => Computer2Client;
  createTransport?: () => unknown;
}) {
  const createClient = options.createClient || (() => new Client({ name: 'autonomous-project-builder', version: '0.2.0' }));
  const createTransport = options.createTransport || (() => new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: { headers: { Authorization: `Bearer ${options.token}` } },
  }));
  let connectedClient: Computer2Client | null = null;
  let connection: Promise<Computer2Client> | null = null;

  const getConnectedClient = () => {
    if (connectedClient) return Promise.resolve(connectedClient);
    if (connection) return connection;
    const client = createClient();
    connection = client.connect(createTransport() as never).then(() => {
      connectedClient = client;
      connection = null;
      return client;
    }, async (error) => {
      connection = null;
      await client.close().catch(() => undefined);
      throw error;
    });
    return connection;
  };

  return async (tool: string, args: Record<string, unknown> = {}) => {
    let retriedExpiredSession = false;
    while (true) {
      const client = await getConnectedClient();
      try {
        return parseComputer2Result(await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 30_000 }));
      } catch (error) {
        if (connectedClient === client) connectedClient = null;
        await client.close().catch(() => undefined);
        if (!retriedExpiredSession && isExpiredSessionError(error)) {
          retriedExpiredSession = true;
          continue;
        }
        throw error;
      }
    }
  };
}

const sharedState = globalThis as typeof globalThis & {
  __computer2SharedCaller?: { url: string; token: string; call: ReturnType<typeof createComputer2Caller> };
};

export async function callComputer2(tool: string, args: Record<string, unknown> = {}) {
  const url = getComputer2Url();
  const token = getServiceToken();
  if (!sharedState.__computer2SharedCaller || sharedState.__computer2SharedCaller.url !== url || sharedState.__computer2SharedCaller.token !== token) {
    sharedState.__computer2SharedCaller = { url, token, call: createComputer2Caller({ url, token }) };
  }
  return sharedState.__computer2SharedCaller.call(tool, args);
}
