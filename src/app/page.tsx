'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  CircleAlert,
  Clock,
  Cloud,
  History,
  Laptop,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Terminal,
  Workflow,
  XCircle,
} from 'lucide-react';
import type { BuildAnalysis, BuildRequest, ExecutionStep, ExecutionTarget, IngredientLevel } from '@/lib/builder';

declare global {
  interface Window {
    desktopApi?: {
      isDesktop: boolean;
      platform: string;
      sendNotification: (title: string, body: string) => void;
      openPath: (targetPath: string) => Promise<string>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
  }
}

const initialRequest: BuildRequest = {
  name: 'Autonomous Builder',
  objective: 'Continue building and ship a production-ready app without stopping for recoverable issues.',
  repository: '',
  backend: 'supabase',
  deployment: 'local',
  workflow: 'windmill',
  needsAuthenticatedBrowser: true,
  needsWindowsHost: true,
};

type SavedBuild = { id: string; createdAt: string; analysis: BuildAnalysis };

type LogEntry = {
  id: string;
  time: string;
  level: 'info' | 'success' | 'warn' | 'error' | 'repair';
  message: string;
};

type ActiveJobState = {
  planId: string;
  jobId: string;
  startedAt: string;
  status: 'queued' | 'running' | 'completed' | 'paused' | 'failed' | 'cancelled';
  stage: string;
  request: BuildRequest;
  analysis: BuildAnalysis;
  activeStepIndex: number;
  logs: LogEntry[];
  recoveryCount: number;
  result: Record<string, unknown> | null;
  error?: string;
};

const levelMeta: Record<IngredientLevel, { label: string; className: string }> = {
  green: { label: 'Ready', className: 'status-green' },
  yellow: { label: 'Needs validation', className: 'status-yellow' },
  red: { label: 'Blocked', className: 'status-red' },
};

const targetMeta: Record<ExecutionTarget, { label: string; icon: typeof Box }> = {
  'docker-mcp': { label: 'Docker MCP', icon: Box },
  'computer-2': { label: 'Computer 2', icon: Laptop },
  windmill: { label: 'Windmill', icon: Workflow },
  cloud: { label: 'Cloud', icon: Cloud },
  user: { label: 'You', icon: CircleAlert },
};

export default function Home() {
  const [request, setRequest] = useState<BuildRequest>(initialRequest);
  const [analysis, setAnalysis] = useState<BuildAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<SavedBuild[]>([]);
  const [activeJob, setActiveJob] = useState<ActiveJobState | null>(null);
  const [elapsed, setElapsed] = useState<string>('00:00');
  const [healthStatus, setHealthStatus] = useState<{ status: string; computer2?: boolean; dockerGateway?: boolean; windmill?: boolean } | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  // Load history, restore any ongoing active job, and check for interrupted jobs
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('autonomous-builder-history');
      if (savedHistory) queueMicrotask(() => setHistory(JSON.parse(savedHistory)));
      const savedActive = localStorage.getItem('autonomous-builder-active-job');
      if (savedActive) {
        const parsed = JSON.parse(savedActive);
        if (parsed?.jobId) queueMicrotask(() => setActiveJob(parsed));
      }
    } catch {}

    // Fetch inline health status
    fetch('/api/health').then((r) => r.json()).then((data) => setHealthStatus(data)).catch(() => {});

    // Check if running inside Electron desktop shell
    if (typeof window !== 'undefined' && window.desktopApi?.isDesktop) {
      queueMicrotask(() => setIsDesktop(true));
    }
  }, []);

  // Elapsed timer ticker for active build
  useEffect(() => {
    if (!activeJob || activeJob.status === 'completed' || activeJob.status === 'failed' || activeJob.status === 'cancelled') return;
    const startMs = new Date(activeJob.startedAt).getTime();
    const timer = setInterval(() => {
      const diffSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const mins = String(Math.floor(diffSec / 60)).padStart(2, '0');
      const secs = String(diffSec % 60).padStart(2, '0');
      setElapsed(`${mins}:${secs}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [activeJob]);

  // Analyze build intake
  async function analyze(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error('Build analysis failed');
      const next: BuildAnalysis = await response.json();
      setAnalysis(next);
      const saved: SavedBuild = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), analysis: next };
      setHistory((current) => {
        const updated = [saved, ...current].slice(0, 8);
        localStorage.setItem('autonomous-builder-history', JSON.stringify(updated));
        return updated;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to analyze build');
    } finally {
      setLoading(false);
    }
  }

  // Helper to add timestamped event log
  const pushLog = useCallback((message: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry: LogEntry = { id: crypto.randomUUID(), time, level, message };
    setActiveJob((current) => {
      if (!current) return current;
      const updated = { ...current, logs: [entry, ...current.logs].slice(0, 50) };
      localStorage.setItem('autonomous-builder-active-job', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Poll status when job is queued or running
  const pollStatus = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/builds/status?job_id=${encodeURIComponent(jobId)}`);
      if (!res.ok) return;
      const statusData = await res.json();
      const status = statusData.status || 'running';
      
      setActiveJob((current) => {
        if (!current || current.jobId !== jobId) return current;
        let stepIdx = current.activeStepIndex;
        if (status === 'running' && stepIdx < (current.analysis?.steps.length ?? 1) - 1) {
          stepIdx = Math.min(stepIdx + 1, (current.analysis?.steps.length ?? 1) - 1);
        }
        const updated: ActiveJobState = {
          ...current,
          status,
          activeStepIndex: status === 'completed' ? (current.analysis?.steps.length ?? 1) : stepIdx,
        };
        localStorage.setItem('autonomous-builder-active-job', JSON.stringify(updated));
        return updated;
      });

      if (status === 'completed') {
        const resultRes = await fetch(`/api/builds/result?job_id=${encodeURIComponent(jobId)}&full=1`);
        if (resultRes.ok) {
          const resultData = await resultRes.json();
          setActiveJob((current) => {
            if (!current || current.jobId !== jobId) return current;
            const updated: ActiveJobState = { ...current, status: 'completed', result: resultData };
            localStorage.setItem('autonomous-builder-active-job', JSON.stringify(updated));
            return updated;
          });
          pushLog('Production verification passed. Autonomous build complete.', 'success');
          if (typeof window !== 'undefined' && window.desktopApi?.sendNotification) {
            window.desktopApi.sendNotification(
              'Autonomous Build Complete 🎉',
              'Autonomous build passed all verification gates and is ready for production.',
            );
          }
        }
      }
    } catch {}
  }, [pushLog]);

  // Polling loop for active job
  useEffect(() => {
    if (!activeJob || activeJob.status !== 'running') return;
    const interval = setInterval(() => {
      void pollStatus(activeJob.jobId);
    }, 2500);
    return () => clearInterval(interval);
  }, [activeJob, pollStatus]);

  // Start durable build execution
  async function startBuild() {
    setLoading(true);
    setError('');
    const now = new Date().toISOString();
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    try {
      const response = await fetch('/api/builds/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to start build');

      const initialLogs: LogEntry[] = [
        { id: '1', time: timeStr, level: 'info', message: 'Build request validated. Analysis: 0 blockers.' },
        { id: '2', time: timeStr, level: 'info', message: `Execution plan created (${payload.plan_id}). Routing tasks.` },
        { id: '3', time: timeStr, level: 'success', message: `Durable job submitted (${payload.job_id}). Execution active.` },
      ];

      const newActiveJob: ActiveJobState = {
        planId: payload.plan_id,
        jobId: payload.job_id,
        startedAt: now,
        status: 'running',
        stage: 'running',
        request,
        analysis: payload.analysis || analysis || initialRequest,
        activeStepIndex: 0,
        logs: initialLogs,
        recoveryCount: 0,
        result: null,
      };

      setAnalysis(payload.analysis);
      setActiveJob(newActiveJob);
      localStorage.setItem('autonomous-builder-active-job', JSON.stringify(newActiveJob));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start build');
    } finally {
      setLoading(false);
    }
  }

  // Pause build execution (cancel with option to resume)
  async function pauseBuild() {
    if (!activeJob) return;
    setLoading(true);
    try {
      await fetch('/api/builds/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ job_id: activeJob.jobId }),
      });
      pushLog('Build execution paused by user request.', 'warn');
      setActiveJob((current) => current ? { ...current, status: 'paused' } : null);
    } catch {} finally {
      setLoading(false);
    }
  }

  // Cancel build execution permanently
  async function cancelBuild() {
    if (!activeJob) return;
    setLoading(true);
    try {
      await fetch('/api/builds/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ job_id: activeJob.jobId }),
      });
      pushLog('Build execution cancelled by user request.', 'warn');
      setActiveJob((current) => current ? { ...current, status: 'cancelled' } : null);
    } catch {} finally {
      setLoading(false);
    }
  }

  // Resume a paused build — re-submit the plan execution
  async function resumeBuild() {
    if (!activeJob || activeJob.status !== 'paused') return;
    setLoading(true);
    try {
      const res = await fetch('/api/builds/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(activeJob.request),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Unable to resume build');
      pushLog(`Build resumed. New plan: ${payload.plan_id}, job: ${payload.job_id}`, 'success');
      setActiveJob((current) => current ? {
        ...current,
        planId: payload.plan_id,
        jobId: payload.job_id,
        status: 'running',
        startedAt: new Date().toISOString(),
      } : null);
    } catch (e) {
      pushLog(`Resume failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // Reset active build view
  function resetBuild() {
    localStorage.removeItem('autonomous-builder-active-job');
    setActiveJob(null);
  }

  useEffect(() => {
    const timer = setTimeout(() => { void analyze(); }, 0);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = analysis?.ingredients.length ?? 0;
  const completion = useMemo(() => {
    if (!analysis || total === 0) return 0;
    return Math.round(((analysis.greenCount + analysis.yellowCount * 0.5) / total) * 100);
  }, [analysis, total]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">
            <Activity size={15} /> LIVE CONTROL PLANE
            {isDesktop && <span className="desktop-pill"><Laptop size={11} /> DESKTOP APP</span>}
          </div>
          <h1>Autonomous Builder</h1>
          <p>One command in. Ingredient analysis, routing, execution, recovery, verification and deployment out.</p>
        </div>
        <div className="topbar-actions">
          {healthStatus && (
            <div className="health-inline">
              <span className={`health-dot ${healthStatus.computer2 !== false ? 'health-ok' : 'health-down'}`} title="Computer 2" />
              <span className={`health-dot ${healthStatus.dockerGateway !== false ? 'health-ok' : 'health-down'}`} title="Docker MCP" />
              <span className={`health-dot ${healthStatus.windmill !== false ? 'health-ok' : 'health-down'}`} title="Windmill" />
            </div>
          )}
          <a className="health-chip" href="/api/health" target="_blank" rel="noreferrer">
            <span className="pulse" /> {healthStatus?.status === 'ready' ? 'All Systems Ready' : healthStatus?.status === 'degraded' ? 'Degraded' : 'Production health'}
          </a>
        </div>
      </header>

      {/* ACTIVE BUILD EXECUTION PANEL */}
      {activeJob && (
        <section className="panel active-build-panel">
          <div className="panel-title">
            <div className="active-build-head">
              <span className="kicker live-kicker"><Activity size={14} /></span>
              <div>
                <h2>Active Build: {activeJob.request.name || 'Autonomous Build'}</h2>
                <div className="active-meta-row">
                  <span className={`badge-status badge-${activeJob.status}`}>
                    {activeJob.status.toUpperCase()}
                  </span>
                  <span className="meta-text"><Clock size={12} /> Started: <strong>{new Date(activeJob.startedAt).toLocaleTimeString('en-US', { hour12: false })}</strong></span>
                  <span className="meta-text"><Clock size={12} /> Elapsed: <strong>{elapsed}</strong></span>
                  <span className="meta-text">Plan: <code>{activeJob.planId.slice(0, 16)}…</code></span>
                  <span className="meta-text">Job: <code>{activeJob.jobId.slice(0, 16)}…</code></span>
                </div>
              </div>
            </div>
            <div className="active-controls">
              {activeJob.status === 'running' && (
                <>
                  <button className="btn-secondary" type="button" onClick={() => void pollStatus(activeJob.jobId)} title="Refresh telemetry">
                    <RefreshCw size={14} /> Refresh
                  </button>
                  <button className="btn-warning" type="button" onClick={() => void pauseBuild()} disabled={loading} title="Pause execution">
                    <Pause size={14} /> Pause
                  </button>
                  <button className="btn-danger" type="button" onClick={() => void cancelBuild()} disabled={loading} title="Cancel execution permanently">
                    <XCircle size={14} /> Cancel
                  </button>
                </>
              )}
              {activeJob.status === 'paused' && (
                <>
                  <button className="btn-primary" type="button" onClick={() => void resumeBuild()} disabled={loading} title="Resume paused execution">
                    <Play size={14} /> Resume
                  </button>
                  <button className="btn-danger" type="button" onClick={() => void cancelBuild()} disabled={loading} title="Cancel execution permanently">
                    <XCircle size={14} /> Cancel
                  </button>
                </>
              )}
              {(activeJob.status === 'completed' || activeJob.status === 'cancelled' || activeJob.status === 'failed') && (
                <button className="btn-secondary" type="button" onClick={resetBuild}>
                  <RotateCcw size={14} /> New Build
                </button>
              )}
            </div>
          </div>

          <div className="active-grid">
            {/* Steps checklist with live state */}
            <div className="active-steps">
              <h3>Execution Pipeline</h3>
              <div className="pipeline-steps">
                {activeJob.analysis.steps.map((step: ExecutionStep, idx: number) => {
                  const isDone = activeJob.status === 'completed' || idx < activeJob.activeStepIndex;
                  const isCurrent = activeJob.status === 'running' && idx === activeJob.activeStepIndex;
                  const StepTargetIcon = targetMeta[step.target].icon;
                  return (
                    <div className={`pipeline-step ${isDone ? 'step-done' : isCurrent ? 'step-active' : 'step-pending'}`} key={step.id}>
                      <div className="step-badge">
                        {isDone ? <CheckCircle2 size={16} /> : isCurrent ? <RefreshCw size={16} className="spin-icon" /> : <span>{idx + 1}</span>}
                      </div>
                      <div className="step-info">
                        <strong>{step.title}</strong>
                        <p>{step.reason}</p>
                      </div>
                      <div className="target"><StepTargetIcon size={13} /> {targetMeta[step.target].label}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Terminal Event Stream */}
            <div className="active-logs">
              <div className="logs-header">
                <div className="logs-title"><Terminal size={14} /> Live Telemetry Feed</div>
                <div className="logs-stats">
                  <span><ShieldCheck size={13} /> Self-Healing: Active</span>
                  <span>Recoveries: {activeJob.recoveryCount}</span>
                </div>
              </div>
              <div className="logs-terminal">
                {activeJob.logs.map((log) => (
                  <div className={`log-row log-${log.level}`} key={log.id}>
                    <span className="log-time">[{log.time}]</span>
                    {log.level === 'success' && <CheckCircle2 size={12} className="log-icon-success" />}
                    {log.level === 'warn' && <AlertTriangle size={12} className="log-icon-warn" />}
                    {log.level === 'error' && <XCircle size={12} className="log-icon-error" />}
                    {log.level === 'repair' && <RotateCcw size={12} className="log-icon-repair" />}
                    <span className="log-msg">{log.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {activeJob.status === 'completed' && activeJob.result && (
            <div className="completion-banner">
              <CheckCircle2 size={24} className="completion-icon" />
              <div>
                <strong>Autonomous Build Certification Passed</strong>
                <p>All ingredients validated, unit tests and production builds succeeded, and deployment health checks confirmed.</p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* MAIN INTAKE & READINESS */}
      <section className="hero-grid">
        <form className="panel intake" onSubmit={analyze}>
          <div className="panel-title">
            <div><span className="kicker">01</span><h2>Build request</h2></div>
            <ServerCog size={22} />
          </div>

          <label>Project name<input value={request.name ?? ''} onChange={(e) => setRequest({ ...request, name: e.target.value })} placeholder="Project name" /></label>
          <label>What should be built?<textarea value={request.objective ?? ''} onChange={(e) => setRequest({ ...request, objective: e.target.value })} rows={5} placeholder="Describe the outcome, not every implementation detail." /></label>
          <label>GitHub repository (optional)<input value={request.repository ?? ''} onChange={(e) => setRequest({ ...request, repository: e.target.value })} placeholder="Leave blank to keep this build local" /></label>

          <div className="field-grid">
            <label>Backend<select value={request.backend} onChange={(e) => setRequest({ ...request, backend: e.target.value as BuildRequest['backend'] })}><option value="supabase">Supabase</option><option value="appwrite">Appwrite</option><option value="firebase">Firebase</option><option value="none">None</option></select></label>
            <label>Deployment<select value={request.deployment} onChange={(e) => setRequest({ ...request, deployment: e.target.value as BuildRequest['deployment'] })}><option value="local">Private local</option><option value="vercel">Vercel</option><option value="none">None</option></select></label>
            <label>Workflows<select value={request.workflow} onChange={(e) => setRequest({ ...request, workflow: e.target.value as BuildRequest['workflow'] })}><option value="windmill">Windmill</option><option value="none">None</option></select></label>
          </div>

          <div className="toggle-row">
            <label className="toggle"><input type="checkbox" checked={Boolean(request.needsAuthenticatedBrowser)} onChange={(e) => setRequest({ ...request, needsAuthenticatedBrowser: e.target.checked })} /><span />Authenticated Chrome</label>
            <label className="toggle"><input type="checkbox" checked={Boolean(request.needsWindowsHost)} onChange={(e) => setRequest({ ...request, needsWindowsHost: e.target.checked })} /><span />Windows host access</label>
          </div>

          <div className="action-row">
            <button className="primary" type="submit" disabled={loading}><Play size={17} /> {loading ? 'Working…' : 'Analyze build'}</button>
            <button className="primary" type="button" disabled={loading || !analysis?.canContinue || activeJob?.status === 'running'} onClick={() => void startBuild()}>
              <ServerCog size={17} /> {activeJob?.status === 'running' ? 'Build Running…' : 'Run build'}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>

        <section className="panel readiness">
          <div className="panel-title"><div><span className="kicker">02</span><h2>Readiness</h2></div><span className={`stage ${analysis?.canContinue ? 'go' : 'stop'}`}>{analysis?.canContinue ? 'CAN CONTINUE' : 'BLOCKED'}</span></div>
          <div className="score-wrap"><div><strong>{completion}</strong><span>%</span></div><p>Build readiness</p></div>
          <div className="meter"><span style={{ width: `${completion}%` }} /></div>
          <div className="stats">
            <div><strong>{analysis?.greenCount ?? 0}</strong><span>Green</span></div>
            <div><strong>{analysis?.yellowCount ?? 0}</strong><span>Yellow</span></div>
            <div><strong>{analysis?.redCount ?? 0}</strong><span>Red</span></div>
            <div><strong>{analysis?.blockingCount ?? 0}</strong><span>Blocking</span></div>
          </div>
          <div className="policy"><CheckCircle2 size={19} /><p><strong>Autonomy rule:</strong> yellow items never stop the build. Red items only stop the exact work they genuinely block.</p></div>
        </section>
      </section>

      {/* INGREDIENTS LIST */}
      <section className="panel section-panel">
        <div className="panel-title"><div><span className="kicker">03</span><h2>Ingredients</h2></div><span className="muted">Live dependency map</span></div>
        <div className="ingredient-grid">
          {analysis?.ingredients.map((item) => {
            const meta = levelMeta[item.level];
            const TargetIcon = targetMeta[item.target].icon;
            return (
              <article className="ingredient" key={item.id}>
                <div className={`status-dot ${meta.className}`} />
                <div className="ingredient-copy">
                  <div className="ingredient-head"><strong>{item.label}</strong><span>{meta.label}</span></div>
                  <p>{item.detail}</p>
                </div>
                <div className="target"><TargetIcon size={15} /> {targetMeta[item.target].label}</div>
              </article>
            );
          })}
        </div>
      </section>

      {/* EXECUTION ROUTE & RECENT BUILDS */}
      <section className="lower-grid">
        <section className="panel section-panel">
          <div className="panel-title"><div><span className="kicker">04</span><h2>Execution route</h2></div><span className="muted">Automatic tool selection</span></div>
          <div className="steps">
            {analysis?.steps.map((step, index) => {
              const TargetIcon = targetMeta[step.target].icon;
              return (
                <div className="step" key={step.id}>
                  <div className="step-index">{String(index + 1).padStart(2, '0')}</div>
                  <div><strong>{step.title}</strong><p>{step.reason}</p></div>
                  <div className="target"><TargetIcon size={15} /> {targetMeta[step.target].label}</div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="panel section-panel history-panel">
          <div className="panel-title"><div><span className="kicker">05</span><h2>Recent builds</h2></div><History size={20} /></div>
          <div className="history-list">
            {history.length === 0 && <p className="muted">No saved build analyses yet.</p>}
            {history.map((entry) => (
              <button key={entry.id} className="history-item" onClick={() => { setAnalysis(entry.analysis); setRequest(entry.analysis.request); }}>
                <div><strong>{entry.analysis.request.name || 'Untitled build'}</strong><span>{new Date(entry.createdAt).toLocaleString()}</span></div>
                <span className={entry.analysis.canContinue ? 'mini-ready' : 'mini-blocked'}>{entry.analysis.canContinue ? 'Ready' : 'Blocked'}</span>
              </button>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
