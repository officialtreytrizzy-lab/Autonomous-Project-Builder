import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createEventResponse } from '../src/app/api/events/route.ts';
import { projectSpine, readWorkerEventBatch } from '../src/lib/intake/events.ts';
import { IntakeStore } from '../src/lib/intake/store.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'project-events-'));
  const store = new IntakeStore(join(root, 'state.db'));
  const project = store.createProject({ name: 'Events', objective: 'Replay truth', workspace: join(root, 'project') });
  const events = [];
  for (let index = 1; index <= 4; index += 1) {
    events.push(store.appendEvent(project.id, {
      category: 'stage', stage: `stage-${index}`, severity: 'info', source: 'test', humanMessage: `Event ${index}`,
    }));
  }
  return { root, store, project, events, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

function parseFrames(text) {
  return text.trim().split('\n\n').filter((frame) => frame.startsWith('id:')).map((frame) => {
    const lines = frame.split('\n');
    return {
      id: lines.find((line) => line.startsWith('id: ')).slice(4),
      data: JSON.parse(lines.find((line) => line.startsWith('data: ')).slice(6)),
    };
  });
}

test('event endpoint replays only events after Last-Event-ID in sequence order', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const request = new Request(`http://127.0.0.1/api/events?project_id=${f.project.id}&once=1`, {
    headers: { 'Last-Event-ID': f.events[1].eventId },
  });
  const response = createEventResponse(request, f.store);
  const frames = parseFrames(await response.text());
  assert.deepEqual(frames.map((frame) => frame.data.sequence), [3, 4]);
  assert.equal(new Set(frames.map((frame) => frame.id)).size, 2);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
});

test('polling fallback reads from the same sequence-authoritative database', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const request = new Request(`http://127.0.0.1/api/events?project_id=${f.project.id}&transport=poll&after=2`);
  const response = createEventResponse(request, f.store);
  const payload = await response.json();
  assert.deepEqual(payload.events.map((event) => event.sequence), [3, 4]);
  assert.equal(payload.latest_sequence, 4);
});

test('spine projection uses persisted stages and repair branches only', () => {
  const event = (input) => ({
    eventId: `event-${input.sequence}`, projectId: 'project-1', timestamp: new Date(input.sequence).toISOString(),
    severity: 'info', source: 'test', humanMessage: 'truth', ...input,
  });
  const projection = projectSpine([
    event({ sequence: 1, category: 'stage', stage: 'implementation' }),
    event({ sequence: 2, category: 'repair', stage: 'implementation' }),
    event({ sequence: 3, category: 'recovered', stage: 'implementation' }),
    event({ sequence: 3, category: 'recovered', stage: 'implementation' }),
  ]);
  assert.equal(projection.nodes[0].repairBranches.length, 1);
  assert.equal(projection.nodes[0].repairBranches[0].reconnected, true);
  assert.equal(projection.highestSequence, 3);
});

test('worker JSONL ingestion checkpoints bytes and never exposes reasoning records', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'worker-jsonl-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'worker.events.jsonl');
  writeFileSync(path, [
    JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'npm test', status: 'completed', aggregated_output: 'ok' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'private chain of thought' } }),
    '{"type":"turn.completed"',
  ].join('\n'));
  const first = readWorkerEventBatch(path, 0);
  assert.equal(first.events.length, 1);
  assert.equal(JSON.stringify(first.events).includes('private chain of thought'), false);
  assert.equal(first.events[0].technicalPayload.command, 'npm test');

  appendFileSync(path, '}\n');
  const second = readWorkerEventBatch(path, first.nextOffset);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].category, 'stage');
  const replay = readWorkerEventBatch(path, second.nextOffset);
  assert.equal(replay.events.length, 0);
});
