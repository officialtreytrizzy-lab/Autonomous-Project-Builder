'use client';

import { Activity, Braces, MessageCircleMore, Radio } from 'lucide-react';
import { useState } from 'react';

import type { ProjectEvent } from './types';

export function EventStream({ events }: { events: ProjectEvent[] }) {
  const [technical, setTechnical] = useState(false);

  return (
    <section className="event-stream" aria-label="Live event narrative">
      <header>
        <div>
          <div className="event-stream-badge-row">
            <span>Live build narrative</span>
            {events.length > 0 && (
              <span className="live-stream-count">
                <Radio size={10} className="stream-radio-icon" />
                {events.length} events
              </span>
            )}
          </div>
          <h2>{technical ? 'Technical stream' : 'What the Builder is doing'}</h2>
        </div>
        <button onClick={() => setTechnical((value) => !value)}>
          {technical ? <MessageCircleMore size={14} /> : <Braces size={14} />}
          {technical ? 'Human view' : 'Technical view'}
        </button>
      </header>
      <div className="event-lines" aria-live="polite">
        {events.length ? (
          [...events].reverse().map((event) => (
            <article key={event.eventId} className={`event-line severity-${event.severity}`}>
              <span className="event-sequence">{String(event.sequence).padStart(3, '0')}</span>
              <span className="event-light" />
              <div>
                <strong>{technical ? `${event.source} · ${event.target || 'local'}` : event.humanMessage}</strong>
                <small>
                  {technical
                    ? JSON.stringify(event.technicalPayload || { category: event.category, stage: event.stage })
                    : `${event.stage.replaceAll('-', ' ')} · ${new Date(event.timestamp).toLocaleTimeString()}`}
                </small>
              </div>
            </article>
          ))
        ) : (
          <p className="stream-empty">The event stream will appear as persisted work begins.</p>
        )}
      </div>
    </section>
  );
}
