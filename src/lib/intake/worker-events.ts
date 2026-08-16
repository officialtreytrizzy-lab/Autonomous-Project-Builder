import { existsSync, readFileSync } from 'node:fs';

type WorkerProjectedEvent = {
  category: string;
  stage: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  humanMessage: string;
  technicalPayload?: unknown;
};

function workerRecordToEvent(value: unknown): WorkerProjectedEvent | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.type === 'turn.completed') {
    return { category: 'stage', stage: 'implementation', severity: 'success', humanMessage: 'Completed an autonomous implementation turn.' };
  }
  if (record.type === 'error') {
    return {
      category: 'repair', stage: 'implementation', severity: 'warning', humanMessage: 'The implementation worker reported an error for recovery.',
      technicalPayload: { message: typeof record.message === 'string' ? record.message : 'Worker error' },
    };
  }
  if (record.type !== 'item.completed' || !record.item || typeof record.item !== 'object') return null;
  const item = record.item as Record<string, unknown>;
  if (!['command_execution', 'mcp_tool_call', 'file_change'].includes(String(item.type || ''))) return null;
  const status = String(item.status || 'completed');
  const failed = ['failed', 'error'].includes(status);
  const technicalPayload = Object.fromEntries(
    ['type', 'command', 'tool', 'server', 'status', 'exit_code', 'aggregated_output']
      .filter((key) => item[key] !== undefined)
      .map((key) => [key, item[key]]),
  );
  const label = item.type === 'command_execution' ? 'command' : item.type === 'mcp_tool_call' ? 'tool action' : 'file change';
  return {
    category: failed ? 'repair' : 'tool',
    stage: 'implementation',
    severity: failed ? 'warning' : 'info',
    humanMessage: failed ? `A ${label} failed and entered recovery.` : `Completed a ${label}.`,
    technicalPayload,
  };
}

export function readWorkerEventBatch(path: string, offset: number) {
  if (!existsSync(path)) return { events: [] as WorkerProjectedEvent[], nextOffset: offset };
  const buffer = readFileSync(path);
  if (offset >= buffer.length) return { events: [] as WorkerProjectedEvent[], nextOffset: offset };
  const remaining = buffer.subarray(offset);
  const lastNewline = remaining.lastIndexOf(10);
  if (lastNewline < 0) return { events: [] as WorkerProjectedEvent[], nextOffset: offset };
  const complete = remaining.subarray(0, lastNewline + 1);
  const events: WorkerProjectedEvent[] = [];
  for (const line of complete.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = workerRecordToEvent(JSON.parse(line));
      if (event) events.push(event);
    } catch {
      // A malformed worker line is skipped; byte progress keeps subsequent valid records replayable.
    }
  }
  return { events, nextOffset: offset + complete.length };
}
