import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function getComputer2Url() {
  return process.env.COMPUTER2_MCP_URL?.trim() || process.env.MCP_MAIN_NODE_URL?.trim() || 'http://127.0.0.1:3000/mcp';
}

function getServiceToken() {
  const value = process.env.BUILDER_SERVICE_TOKEN?.trim() || process.env.MCP_AUTH_TOKEN?.trim();
  if (!value) throw new Error('Computer 2 MCP service token is not configured');
  return value;
}

function parseTextResult(result: unknown) {
  const value = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  const text = value.content?.find((item) => item.type === 'text')?.text ?? '';
  if (value.isError) throw new Error(text || 'Computer 2 MCP call failed');
  if (!text) return value;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return { text };
  }
}

/**
 * Error pattern memory for recovery engine.
 * Maps error signatures to successful recovery strategies.
 */
const recoveryMemory = new Map<string, { strategy: string; lastUsed: number }>();

function errorSignature(tool: string, error: Error): string {
  const msg = error.message.toLowerCase();
  if (msg.includes('timeout')) return `${tool}:timeout`;
  if (msg.includes('econnrefused') || msg.includes('econnreset')) return `${tool}:connection`;
  if (msg.includes('not found')) return `${tool}:not_found`;
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')) return `${tool}:auth`;
  return `${tool}:unknown`;
}

function recordRecovery(signature: string, strategy: string) {
  recoveryMemory.set(signature, { strategy, lastUsed: Date.now() });
}

function getKnownRecovery(signature: string): string | null {
  const entry = recoveryMemory.get(signature);
  if (entry && Date.now() - entry.lastUsed < 30 * 60 * 1000) return entry.strategy;
  return null;
}

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
};

/**
 * Execute an MCP tool call with exponential backoff retry and recovery tracking.
 */
export async function callComputer2WithRetry(
  tool: string,
  args: Record<string, unknown> = {},
  options: RetryOptions = {},
): Promise<{ result: unknown; attempts: number; recovered: boolean }> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelay = options.baseDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 10000;

  let lastError: Error = new Error('No attempts made');
  let recovered = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await callComputer2(tool, args);
      if (attempt > 1) {
        recovered = true;
        recordRecovery(errorSignature(tool, lastError), `retry_attempt_${attempt}`);
      }
      return { result, attempts: attempt, recovered };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const sig = errorSignature(tool, lastError);

      // Check if error is non-retryable (auth, not_found)
      if (sig.endsWith(':auth') || sig.endsWith(':not_found')) {
        throw lastError;
      }

      if (attempt < maxAttempts) {
        const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15x
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1) * jitter, maxDelay);
        options.onRetry?.(attempt, lastError, delay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Try a primary tool, then fall back to alternates if available.
 */
export async function callComputer2WithFallback(
  primaryTool: string,
  args: Record<string, unknown>,
  fallbackTools: string[],
  retryOptions?: RetryOptions,
): Promise<{ result: unknown; tool: string; attempts: number; recovered: boolean; usedFallback: boolean }> {
  // Try primary with retry
  try {
    const primary = await callComputer2WithRetry(primaryTool, args, retryOptions);
    return { ...primary, tool: primaryTool, usedFallback: false };
  } catch (primaryError) {
    // Try fallback tools in order
    for (const fallbackTool of fallbackTools) {
      try {
        const fallback = await callComputer2WithRetry(fallbackTool, args, { maxAttempts: 1 });
        const sig = errorSignature(primaryTool, primaryError instanceof Error ? primaryError : new Error(String(primaryError)));
        recordRecovery(sig, `fallback:${fallbackTool}`);
        return { ...fallback, tool: fallbackTool, usedFallback: true };
      } catch {
        // Continue to next fallback
      }
    }
    throw primaryError;
  }
}

/**
 * Get recovery memory stats for telemetry/debugging.
 */
export function getRecoveryStats(): { totalRecoveries: number; patterns: Array<{ signature: string; strategy: string }> } {
  const patterns: Array<{ signature: string; strategy: string }> = [];
  for (const [sig, entry] of recoveryMemory) {
    patterns.push({ signature: sig, strategy: entry.strategy });
  }
  return { totalRecoveries: patterns.length, patterns };
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
    return parseTextResult(await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 120000 }));
  } finally {
    await client.close();
  }
}
