import type { ProjectEvent } from './types.ts';

export type SpineRepairBranch = {
  eventId: string;
  sequence: number;
  message: string;
  errorClass?: string;
  repairAction?: string;
  reconnected: boolean;
  recoveredAtSequence?: number;
};

export type SpineNode = {
  stage: string;
  firstSequence: number;
  lastSequence: number;
  status: 'waiting' | 'active' | 'blocked' | 'complete';
  messages: string[];
  repairBranches: SpineRepairBranch[];
};

export function deduplicateProjectEvents(events: ProjectEvent[]) {
  const bySequence = new Map<number, ProjectEvent>();
  for (const event of events) if (!bySequence.has(event.sequence)) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

export function projectSpine(events: ProjectEvent[]) {
  const ordered = deduplicateProjectEvents(events);
  const nodes: SpineNode[] = [];
  const byStage = new Map<string, SpineNode>();
  for (const event of ordered) {
    let node = byStage.get(event.stage);
    if (!node) {
      node = {
        stage: event.stage,
        firstSequence: event.sequence,
        lastSequence: event.sequence,
        status: 'active',
        messages: [],
        repairBranches: [],
      };
      byStage.set(event.stage, node);
      nodes.push(node);
    }
    node.lastSequence = event.sequence;
    if (event.humanMessage && !node.messages.includes(event.humanMessage)) node.messages.push(event.humanMessage);
    if (event.category === 'repair' || event.category === 'recovery') {
      const payload = event.technicalPayload && typeof event.technicalPayload === 'object' ? event.technicalPayload as Record<string, unknown> : {};
      node.repairBranches.push({
        eventId: event.eventId,
        sequence: event.sequence,
        message: event.humanMessage,
        ...(typeof payload.errorClass === 'string' ? { errorClass: payload.errorClass } : {}),
        ...(typeof payload.repairAction === 'string' ? { repairAction: payload.repairAction } : {}),
        reconnected: false,
      });
    }
    if (event.category === 'recovered') {
      const branch = [...node.repairBranches].reverse().find((candidate) => !candidate.reconnected);
      if (branch) {
        branch.reconnected = true;
        branch.recoveredAtSequence = event.sequence;
      }
    }
    if (event.category === 'blocked' || event.severity === 'error') node.status = 'blocked';
    if (event.category === 'complete' || event.category === 'verification-complete') node.status = 'complete';
  }
  for (let index = 0; index < nodes.length - 1; index += 1) {
    if (nodes[index].status === 'active') nodes[index].status = 'complete';
  }
  return { nodes, highestSequence: ordered.at(-1)?.sequence || 0 };
}
