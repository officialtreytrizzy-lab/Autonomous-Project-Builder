'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { deduplicateProjectEvents, projectSpine } from '@/lib/intake/events';
import type { ProjectEvent } from '@/lib/intake/types';

function mergeEvents(current: ProjectEvent[], incoming: ProjectEvent[]) {
  return deduplicateProjectEvents([...current, ...incoming]);
}

export function useProjectEvents(projectId: string) {
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [transport, setTransport] = useState<'sse' | 'poll'>('sse');
  const [connected, setConnected] = useState(false);
  const highestSequence = useRef(0);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;

    const accept = (incoming: ProjectEvent[]) => {
      if (!incoming.length || disposed) return;
      highestSequence.current = Math.max(highestSequence.current, ...incoming.map((event) => event.sequence));
      setEvents((current) => mergeEvents(current, incoming));
    };
    const poll = async () => {
      try {
        const response = await fetch(`/api/events?project_id=${encodeURIComponent(projectId)}&transport=poll&after=${highestSequence.current}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Event poll failed with HTTP ${response.status}`);
        const payload = await response.json() as { events?: ProjectEvent[] };
        accept(payload.events || []);
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    const beginPolling = () => {
      source?.close();
      source = null;
      setTransport('poll');
      void poll();
      pollTimer = setInterval(() => void poll(), 2000);
    };
    const beginSse = () => {
      source = new EventSource(`/api/events?project_id=${encodeURIComponent(projectId)}&after=${highestSequence.current}`);
      source.addEventListener('project', (message) => {
        failures = 0;
        setConnected(true);
        accept([JSON.parse((message as MessageEvent<string>).data) as ProjectEvent]);
      });
      source.onerror = () => {
        setConnected(false);
        failures += 1;
        if (failures >= 3) beginPolling();
      };
    };
    beginSse();
    return () => {
      disposed = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [projectId]);

  const spine = useMemo(() => projectSpine(events), [events]);
  return { events, spine, connected, transport, highestSequence: spine.highestSequence };
}
