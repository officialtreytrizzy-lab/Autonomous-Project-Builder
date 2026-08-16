'use client';

import { ExternalLink, FolderOpen, ListRestart, Pause, RotateCcw, Square, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { BuildRecord } from '@/lib/build-store';
import { useProjectEvents } from '@/hooks/useProjectEvents';
import { EventStream } from './EventStream';
import { LivingBuildSpine } from './LivingBuildSpine';

const terminal = new Set(['complete', 'failed', 'cancelled', 'blocked']);

export function BuildMode({ projectId, initialBuild, reconciled, onBuild }: {
  projectId: string;
  initialBuild: BuildRecord | null;
  reconciled: boolean;
  onBuild(build: BuildRecord): void;
}) {
  const build = initialBuild;
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [showLogs, setShowLogs] = useState(false);
  const { events, spine, connected, transport } = useProjectEvents(projectId);
  const buildId = build?.id;
  const buildStatus = build?.status;
  useEffect(() => {
    if (!buildId || !buildStatus || terminal.has(buildStatus)) return;
    const refresh = async () => {
      const response = await fetch(`/api/builds/status?build_id=${encodeURIComponent(buildId)}`, { cache: 'no-store' });
      if (response.ok) { const next = await response.json() as BuildRecord; onBuild(next); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [buildId, buildStatus, onBuild]);
  const action = async (path: string) => {
    if (!build) return;
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ build_id: build.id }) });
    if (response.ok && path !== '/api/builds/open') {
      const payload = await response.json() as BuildRecord | { builds?: BuildRecord[] };
      if ('id' in payload) onBuild(payload);
      else {
        const resumed = payload.builds?.find((item) => item.id === build.id);
        if (resumed) onBuild(resumed);
        else {
          const refreshed = await fetch(`/api/builds/status?build_id=${encodeURIComponent(build.id)}`, { cache: 'no-store' });
          if (refreshed.ok) onBuild(await refreshed.json() as BuildRecord);
        }
      }
    }
  };
  const toggleLogs = async () => {
    if (build && !showLogs) {
      const response = await fetch(`/api/builds/result?build_id=${build.id}`, { cache: 'no-store' });
      if (response.ok) setLogs((await response.json()).logs || []);
    }
    setShowLogs((value) => !value);
  };
  if (!reconciled) return <section className="mode-scene recovery-scene"><div className="recovery-rings"><span /><span /><span /></div><h1>Recovering persisted state</h1><p>Reconstructing the real event sequence and active Computer 2 job before rendering motion.</p></section>;
  return <section className="mode-scene build-scene">
    <div className="build-hero"><div><span className="scene-number">05 / BUILD</span><h1>{build?.request.name || 'Autonomous build'}</h1><p>{build?.currentStep || 'Waiting for the approved execution job.'}</p></div><div className="build-state"><span className={`state-light status-${build?.status || 'queued'}`} /><div><small>Execution state</small><strong>{build?.status || 'queued'}</strong></div></div></div>
    <div className="build-facts"><div><span>Build</span><strong>{build?.id || 'pending'}</strong></div><div><span>Plan</span><strong>{build?.planId || 'pending'}</strong></div><div><span>Job</span><strong>{build?.jobId || 'pending'}</strong></div><div><span>Connection</span><strong>{connected ? `Live · ${transport.toUpperCase()}` : `Reconnecting · ${transport.toUpperCase()}`}</strong></div><div><span>Retries / Repairs</span><strong>{build?.retryCount || 0} / {build?.repairAttempts || 0}</strong></div></div>
    <div className="build-workspace"><LivingBuildSpine nodes={spine.nodes} /><EventStream events={events} /></div>
    {build ? <div className="build-controls liquid-surface">
      {Boolean((build as BuildRecord & { pauseSupported?: boolean }).pauseSupported) ? <button><Pause size={14} />Pause</button> : null}
      <button disabled={!['interrupted', 'paused'].includes(build.status)} onClick={() => void action('/api/builds/resume')}><ListRestart size={14} />Resume</button><button disabled={terminal.has(build.status)} onClick={() => void action('/api/builds/cancel')}><Square size={13} />Cancel</button><button onClick={() => void toggleLogs()}><Terminal size={14} />{showLogs ? 'Hide logs' : 'View logs'}</button><button onClick={() => void action('/api/builds/open')}><FolderOpen size={14} />Open project</button>{build.appUrl ? <a href={build.appUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open finished app</a> : null}<button disabled={!terminal.has(build.status)} onClick={() => void action('/api/builds/verify')}><RotateCcw size={14} />Rerun verification</button>
    </div> : null}
    {showLogs ? <pre className="technical-log">{logs.map((log) => JSON.stringify(log)).join('\n')}</pre> : null}
    {build?.verification.length ? <section className="verification-gate"><header><span>Production gate</span><h2>Verified completion</h2></header><div>{build.verification.map((check) => <article key={check.name} className={`gate-${check.status}`}><span /><strong>{check.name}</strong><small>{check.detail || check.status}</small></article>)}</div></section> : null}
  </section>;
}
