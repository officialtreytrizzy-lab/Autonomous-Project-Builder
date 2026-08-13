'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Box, CheckCircle2, CircleAlert, Cloud, ExternalLink, FolderOpen, History,
  Laptop, ListRestart, Pause, Play, RefreshCw, RotateCcw, ServerCog, Square, Terminal, Workflow,
} from 'lucide-react';
import type { BuildAnalysis, BuildRequest, ExecutionTarget, IngredientLevel } from '@/lib/builder';
import type { BuildLogEvent, BuildRecord } from '@/lib/build-store';
import { selectBuildForRestore } from '@/lib/build-selection';

const initialRequest: BuildRequest = {
  name: '', objective: '', repository: '', backend: 'none', deployment: 'local', workflow: 'none',
  needsAuthenticatedBrowser: false, needsWindowsHost: true,
};

const terminalStatuses = new Set(['complete', 'failed', 'cancelled', 'blocked']);
const levelMeta: Record<IngredientLevel, { label: string; className: string }> = {
  green: { label: 'Ready', className: 'status-green' },
  yellow: { label: 'Recoverable', className: 'status-yellow' },
  red: { label: 'Blocked', className: 'status-red' },
};
const targetMeta: Record<ExecutionTarget, { label: string; icon: typeof Box }> = {
  'docker-mcp': { label: 'Docker MCP', icon: Box },
  'computer-2': { label: 'Computer 2', icon: Laptop },
  windmill: { label: 'Windmill', icon: Workflow },
  cloud: { label: 'Cloud service', icon: Cloud },
  user: { label: 'You', icon: CircleAlert },
};

function formatElapsed(build: BuildRecord, now: number) {
  const start = new Date(build.startedAt || build.createdAt).getTime();
  const end = build.finishedAt ? new Date(build.finishedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}h ` : ''}${minutes}m ${seconds % 60}s`;
}

function TargetBadge({ target }: { target: ExecutionTarget }) {
  const meta = targetMeta[target];
  const Icon = meta.icon;
  return <span className="target"><Icon size={14} />{meta.label}</span>;
}

function BuildHistory({ builds, activeId, onSelect }: { builds: BuildRecord[]; activeId?: string; onSelect: (build: BuildRecord) => void }) {
  if (builds.length === 0) return <p className="empty-state">No builds yet. Start with a concrete outcome above.</p>;
  return <div className="history-list">{builds.map((build) => (
    <button key={build.id} className={`history-item ${activeId === build.id ? 'selected' : ''}`} onClick={() => onSelect(build)}>
      <div><strong>{build.request.name || 'Untitled build'}</strong><span>{new Date(build.createdAt).toLocaleString()} · {build.id.slice(0, 14)}</span></div>
      <span className={`build-status status-${build.status}`}>{build.status}</span>
    </button>
  ))}</div>;
}

export default function Home() {
  const [request, setRequest] = useState<BuildRequest>(initialRequest);
  const [analysis, setAnalysis] = useState<BuildAnalysis | null>(null);
  const [activeBuild, setActiveBuild] = useState<BuildRecord | null>(null);
  const [history, setHistory] = useState<BuildRecord[]>([]);
  const [logs, setLogs] = useState<BuildLogEvent[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [health, setHealth] = useState<'checking' | 'ready' | 'degraded' | 'unavailable'>('checking');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const refreshHistory = useCallback(async (restoreActive = false) => {
    const response = await fetch('/api/builds', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json() as { builds: BuildRecord[] };
    setHistory(payload.builds);
    if (restoreActive) {
      const latest = selectBuildForRestore(payload.builds);
      if (latest) {
        setActiveBuild(latest);
        setAnalysis(latest.analysis as BuildAnalysis);
        setRequest(latest.request);
      }
    }
  }, []);

  const refreshLogs = useCallback(async (buildId: string) => {
    const response = await fetch(`/api/builds/logs?build_id=${encodeURIComponent(buildId)}`, { cache: 'no-store' });
    if (response.ok) setLogs((await response.json() as { logs: BuildLogEvent[] }).logs);
  }, []);

  const refreshBuild = useCallback(async (buildId: string) => {
    const response = await fetch(`/api/builds/status?build_id=${encodeURIComponent(buildId)}`, { cache: 'no-store' });
    if (!response.ok) return;
    const build = await response.json() as BuildRecord;
    setActiveBuild(build);
    setHistory((current) => current.map((entry) => entry.id === build.id ? build : entry));
    if (showLogs || terminalStatuses.has(build.status)) await refreshLogs(build.id);
  }, [refreshLogs, showLogs]);

  const runAnalyze = useCallback(async (nextRequest: BuildRequest) => {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(nextRequest) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Build analysis failed');
    setAnalysis(payload as BuildAnalysis);
    return payload as BuildAnalysis;
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      const payload = await response.json() as { status?: string; degradedCapabilities?: string[] };
      setHealth(payload.status !== 'ready' ? 'unavailable' : payload.degradedCapabilities?.length ? 'degraded' : 'ready');
    } catch { setHealth('unavailable'); }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      try { await fetch('/api/builds/resume', { method: 'POST' }); } catch {}
      await refreshHistory(true);
      try { await runAnalyze(initialRequest); } catch {}
      await refreshHealth();
    };
    void bootstrap();
  }, [refreshHealth, refreshHistory, runAnalyze]);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshHealth(), 10_000);
    return () => window.clearInterval(timer);
  }, [refreshHealth]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeBuild || terminalStatuses.has(activeBuild.status)) return;
    const timer = window.setInterval(() => void refreshBuild(activeBuild.id), 2000);
    return () => window.clearInterval(timer);
  }, [activeBuild, refreshBuild]);

  async function analyze(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true); setError('');
    try { await runAnalyze(request); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to analyze build'); }
    finally { setLoading(false); }
  }

  async function startBuild() {
    if (!request.objective?.trim()) { setError('Describe the finished application before starting the build.'); return; }
    setLoading(true); setError('');
    try {
      const nextAnalysis = await runAnalyze(request);
      if (!nextAnalysis.canContinue) throw new Error('Resolve the blocking RED ingredient before starting this build.');
      const response = await fetch('/api/builds/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to start build');
      setActiveBuild(payload.build as BuildRecord);
      setHistory((current) => [payload.build as BuildRecord, ...current.filter((item) => item.id !== payload.build.id)]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to start build'); }
    finally { setLoading(false); }
  }

  async function postBuildAction(path: string) {
    if (!activeBuild) return;
    setLoading(true); setError('');
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ build_id: activeBuild.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Build action failed');
      if (payload.id) setActiveBuild(payload as BuildRecord);
      await refreshBuild(activeBuild.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Build action failed'); }
    finally { setLoading(false); }
  }

  function selectBuild(build: BuildRecord) {
    setActiveBuild(build); setAnalysis(build.analysis as BuildAnalysis); setRequest(build.request); setShowLogs(false); void refreshLogs(build.id);
  }

  const total = analysis?.ingredients.length ?? 0;
  const readiness = useMemo(() => total ? Math.round((((analysis?.greenCount || 0) + (analysis?.yellowCount || 0) * 0.5) / total) * 100) : 0, [analysis, total]);
  const elapsed = activeBuild ? formatElapsed(activeBuild, now) : '—';

  return <main className="shell">
    <header className="topbar">
      <div><div className="eyebrow"><Activity size={15} /> PRIVATE BUILD CONTROL / COMPUTER 2</div><h1>Autonomous Builder</h1><p>Describe the finished software. The control plane discovers resources, routes work, repairs failures, verifies production, and leaves the application running locally.</p></div>
      <a className={`health-chip health-${health}`} href="/api/health" target="_blank" rel="noreferrer"><span className="pulse" />Core {health}</a>
    </header>

    <section className="hero-grid">
      <form className="panel intake" onSubmit={analyze}>
        <div className="panel-title"><div><span className="kicker">IN</span><h2>Build request</h2></div><ServerCog size={22} /></div>
        <label>Project name<input value={request.name || ''} onChange={(event) => setRequest({ ...request, name: event.target.value })} placeholder="A clear project name" /></label>
        <label>Finished outcome<textarea required value={request.objective || ''} onChange={(event) => setRequest({ ...request, objective: event.target.value })} rows={6} placeholder="Describe what the completed application must do and how success will be verified." /></label>
        <label>GitHub repository <span className="label-note">optional</span><input value={request.repository || ''} onChange={(event) => setRequest({ ...request, repository: event.target.value })} placeholder="Leave blank for a private Computer 2 workspace" /></label>
        <div className="field-grid">
          <label>Backend<select value={request.backend} onChange={(event) => setRequest({ ...request, backend: event.target.value as BuildRequest['backend'] })}><option value="none">None</option><option value="supabase">Supabase</option><option value="appwrite">Appwrite</option><option value="firebase">Firebase</option></select></label>
          <label>Runtime<select value={request.deployment} onChange={(event) => setRequest({ ...request, deployment: event.target.value as BuildRequest['deployment'] })}><option value="local">Private local</option><option value="vercel">Vercel project deploy</option><option value="none">Build only</option></select></label>
          <label>Orchestration<select value={request.workflow} onChange={(event) => setRequest({ ...request, workflow: event.target.value as BuildRequest['workflow'] })}><option value="none">Automatic</option><option value="windmill">Windmill required</option></select></label>
        </div>
        <div className="toggle-row">
          <label className="toggle"><input type="checkbox" checked={Boolean(request.needsAuthenticatedBrowser)} onChange={(event) => setRequest({ ...request, needsAuthenticatedBrowser: event.target.checked })} /><span />Authenticated Chrome</label>
          <label className="toggle"><input type="checkbox" checked={Boolean(request.needsWindowsHost)} onChange={(event) => setRequest({ ...request, needsWindowsHost: event.target.checked })} /><span />Windows host access</label>
        </div>
        <div className="action-row"><button className="secondary" type="submit" disabled={loading}><RefreshCw size={16} />Analyze resources</button><button className="primary" type="button" disabled={loading || !analysis?.canContinue} onClick={() => void startBuild()}><Play size={17} />{loading ? 'Working…' : 'Start build'}</button></div>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </form>

      <section className="panel readiness">
        <div className="panel-title"><div><span className="kicker">RD</span><h2>Live readiness</h2></div><span className={`stage ${analysis?.canContinue ? 'go' : 'stop'}`}>{analysis?.canContinue ? 'CAN CONTINUE' : 'BLOCKED'}</span></div>
        <div className="score-wrap"><div><strong>{readiness}</strong><span>%</span></div><p>Validated ingredient readiness</p></div>
        <div className="meter"><span style={{ width: `${readiness}%` }} /></div>
        <div className="stats"><div><strong>{analysis?.greenCount || 0}</strong><span>Green</span></div><div><strong>{analysis?.yellowCount || 0}</strong><span>Yellow</span></div><div><strong>{analysis?.redCount || 0}</strong><span>Red</span></div><div><strong>{analysis?.blockingCount || 0}</strong><span>Blocking</span></div></div>
        <div className="policy"><CheckCircle2 size={19} /><p><strong>Autonomy rule</strong> Yellow issues trigger recovery and continue. Only a required RED dependency interrupts the relevant work.</p></div>
      </section>
    </section>

    {activeBuild ? <section className="panel active-build">
      <div className="active-head"><div><span className="kicker">LIVE</span><div><p className="overline">Active build</p><h2>{activeBuild.request.name || 'Untitled build'}</h2></div></div><span className={`build-status status-${activeBuild.status}`}>{activeBuild.status}</span></div>
      <div className="build-metrics"><div><span>Build ID</span><strong>{activeBuild.id}</strong></div><div><span>Plan ID</span><strong>{activeBuild.planId || 'pending'}</strong></div><div><span>Job ID</span><strong>{activeBuild.jobId || 'pending'}</strong></div><div><span>Elapsed</span><strong>{elapsed}</strong></div><div><span>Retries</span><strong>{activeBuild.retryCount}</strong></div><div><span>Repairs</span><strong>{activeBuild.repairAttempts}</strong></div></div>
      <div className="execution-strip"><div><span>Stage</span><strong>{activeBuild.currentStage}</strong></div><div><span>Current step</span><strong>{activeBuild.currentStep}</strong></div><TargetBadge target={activeBuild.executionTarget} /></div>
      <div className="build-actions">
        <button disabled title="The Computer 2 runner does not expose a safe pause for this job type"><Pause size={15} />Pause unavailable</button>
        <button disabled={loading || !['interrupted', 'paused'].includes(activeBuild.status)} onClick={() => void postBuildAction('/api/builds/resume')}><ListRestart size={15} />Resume</button>
        <button disabled={loading || terminalStatuses.has(activeBuild.status)} onClick={() => void postBuildAction('/api/builds/cancel')}><Square size={14} />Cancel</button>
        <button onClick={() => { setShowLogs((value) => !value); void refreshLogs(activeBuild.id); }}><Terminal size={15} />{showLogs ? 'Hide logs' : 'View logs'}</button>
        <button onClick={() => void postBuildAction('/api/builds/open')}><FolderOpen size={15} />Open project</button>
        {activeBuild.appUrl ? <a href={activeBuild.appUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open finished app</a> : null}
        <button disabled={loading || !terminalStatuses.has(activeBuild.status)} onClick={() => void postBuildAction('/api/builds/verify')}><RotateCcw size={15} />Rerun verification</button>
      </div>
      <div className="verification-grid">{activeBuild.verification.length ? activeBuild.verification.map((check) => <div key={check.name} className={`verification verification-${check.status}`}><span>{check.name}</span><strong>{check.status}</strong><p>{check.detail || 'No detail reported'}</p></div>) : <p className="empty-state">Verification begins after implementation reaches the production gate.</p>}</div>
      {(activeBuild.errors.length || activeBuild.warnings.length) ? <div className="issues"><div><h3>Errors</h3>{activeBuild.errors.length ? activeBuild.errors.map((item, index) => <p key={index}>{String(item.errorClass || 'unknown')}: {String(item.message || '')}</p>) : <p>None</p>}</div><div><h3>Warnings</h3>{activeBuild.warnings.length ? activeBuild.warnings.map((warning, index) => <p key={index}>{warning}</p>) : <p>None</p>}</div></div> : null}
      {showLogs ? <div className="log-view" aria-live="polite">{logs.length ? logs.map((log, index) => <div className="log-line" key={index}><time>{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '—'}</time><strong>{log.step || 'event'}</strong><span>{log.target || ''}</span><code>{log.message || (typeof log.result === 'string' ? log.result : JSON.stringify(log.result || ''))}</code></div>) : <p className="empty-state">No build events recorded yet.</p>}</div> : null}
    </section> : null}

    <section className="panel section-panel">
      <div className="panel-title"><div><span className="kicker">MAP</span><h2>Ingredient map</h2></div><span className="muted">Validated against live capabilities</span></div>
      <div className="ingredient-grid">{analysis?.ingredients.map((item) => <article className="ingredient" key={item.id}><div className={`status-dot ${levelMeta[item.level].className}`} /><div className="ingredient-copy"><div className="ingredient-head"><strong>{item.label}</strong><span>{levelMeta[item.level].label}</span></div><p>{item.detail}</p></div><TargetBadge target={item.target} /></article>)}</div>
    </section>

    <section className="lower-grid">
      <section className="panel section-panel"><div className="panel-title"><div><span className="kicker">ROUTE</span><h2>Execution route</h2></div><span className="muted">Capability-aware tool selection</span></div><div className="steps">{analysis?.steps.map((step, index) => <div className="step" key={step.id}><div className="step-index">{String(index + 1).padStart(2, '0')}</div><div><strong>{step.title}</strong><p>{step.reason}</p></div><TargetBadge target={step.target} /></div>)}</div></section>
      <aside className="panel section-panel history-panel"><div className="panel-title"><div><span className="kicker">HIST</span><h2>Build history</h2></div><History size={20} /></div><BuildHistory builds={history} activeId={activeBuild?.id} onSelect={selectBuild} /></aside>
    </section>
  </main>;
}
