import { getIntakeStore, type IntakeStore } from '../../../lib/intake/store.ts';

const encoder = new TextEncoder();

function sseFrame(event: ReturnType<IntakeStore['eventsAfter']>[number]) {
  return `id: ${event.eventId}\nevent: project\ndata: ${JSON.stringify(event)}\n\n`;
}

function afterSequence(request: Request, store: IntakeStore, projectId: string) {
  const url = new URL(request.url);
  const after = url.searchParams.get('after');
  const explicit = after === null ? null : Number(after);
  if (explicit !== null && Number.isInteger(explicit) && explicit >= 0) return explicit;
  const eventId = request.headers.get('last-event-id') || '';
  return eventId ? store.eventSequence(projectId, eventId) ?? 0 : 0;
}

export function createEventResponse(request: Request, store: IntakeStore) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id')?.trim() || '';
  if (!projectId || !store.getProject(projectId)) {
    return Response.json({ error: 'A valid project_id is required' }, { status: 400 });
  }
  let cursor = afterSequence(request, store, projectId);
  if (url.searchParams.get('transport') === 'poll') {
    const events = store.eventsAfter(projectId, cursor);
    return Response.json({ events, latest_sequence: events.at(-1)?.sequence ?? cursor }, {
      headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
    });
  }

  const once = url.searchParams.get('once') === '1';
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const replay = () => {
        const events = store.eventsAfter(projectId, cursor);
        for (const event of events) {
          controller.enqueue(encoder.encode(sseFrame(event)));
          cursor = event.sequence;
        }
      };
      replay();
      if (once) {
        controller.close();
        return;
      }
      pollTimer = setInterval(replay, 750);
      heartbeatTimer = setInterval(() => controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`)), 15_000);
    },
    cancel() {
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

export async function GET(request: Request) {
  return createEventResponse(request, getIntakeStore());
}
