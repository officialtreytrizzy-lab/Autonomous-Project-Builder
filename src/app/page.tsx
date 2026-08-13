'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Activity, Box, CheckCircle2, CircleAlert, Cloud, History, Laptop, Play, ServerCog, Workflow } from 'lucide-react';
import type { BuildAnalysis, BuildRequest, ExecutionTarget, IngredientLevel } from '@/lib/builder';

const initialRequest: BuildRequest = {
  name: 'Autonomous Builder',
  objective: 'Continue building and ship a production-ready app without stopping for recoverable issues.',
  repository: 'officialtreytrizzy-lab/Autonomous-Project-Builder',
  backend: 'supabase',
  deployment: 'vercel',
  workflow: 'windmill',
  needsAuthenticatedBrowser: true,
  needsWindowsHost: true,
};

type SavedBuild = { id: string; createdAt: string; analysis: BuildAnalysis };

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

  useEffect(() => {
    try {
      const saved = localStorage.getItem('autonomous-builder-history');
      if (saved) queueMicrotask(() => setHistory(JSON.parse(saved))); 
    } catch {}
  }, []);

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

  useEffect(() => { const timer = setTimeout(() => { void analyze(); }, 0); return () => clearTimeout(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = analysis?.ingredients.length ?? 0;
  const completion = useMemo(() => {
    if (!analysis || total === 0) return 0;
    return Math.round(((analysis.greenCount + analysis.yellowCount * 0.5) / total) * 100);
  }, [analysis, total]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow"><Activity size={15} /> LIVE CONTROL PLANE</div>
          <h1>Autonomous Builder</h1>
          <p>One command in. Ingredient analysis, routing, execution, recovery, verification and deployment out.</p>
        </div>
        <a className="health-chip" href="/api/health" target="_blank" rel="noreferrer">
          <span className="pulse" /> Production health
        </a>
      </header>

      <section className="hero-grid">
        <form className="panel intake" onSubmit={analyze}>
          <div className="panel-title">
            <div><span className="kicker">01</span><h2>Build request</h2></div>
            <ServerCog size={22} />
          </div>

          <label>Project name<input value={request.name ?? ''} onChange={(e) => setRequest({ ...request, name: e.target.value })} placeholder="Project name" /></label>
          <label>What should be built?<textarea value={request.objective ?? ''} onChange={(e) => setRequest({ ...request, objective: e.target.value })} rows={5} placeholder="Describe the outcome, not every implementation detail." /></label>
          <label>GitHub repository<input value={request.repository ?? ''} onChange={(e) => setRequest({ ...request, repository: e.target.value })} placeholder="owner/repository" /></label>

          <div className="field-grid">
            <label>Backend<select value={request.backend} onChange={(e) => setRequest({ ...request, backend: e.target.value as BuildRequest['backend'] })}><option value="supabase">Supabase</option><option value="appwrite">Appwrite</option><option value="firebase">Firebase</option><option value="none">None</option></select></label>
            <label>Deployment<select value={request.deployment} onChange={(e) => setRequest({ ...request, deployment: e.target.value as BuildRequest['deployment'] })}><option value="vercel">Vercel</option><option value="none">None</option></select></label>
            <label>Workflows<select value={request.workflow} onChange={(e) => setRequest({ ...request, workflow: e.target.value as BuildRequest['workflow'] })}><option value="windmill">Windmill</option><option value="none">None</option></select></label>
          </div>

          <div className="toggle-row">
            <label className="toggle"><input type="checkbox" checked={Boolean(request.needsAuthenticatedBrowser)} onChange={(e) => setRequest({ ...request, needsAuthenticatedBrowser: e.target.checked })} /><span />Authenticated Chrome</label>
            <label className="toggle"><input type="checkbox" checked={Boolean(request.needsWindowsHost)} onChange={(e) => setRequest({ ...request, needsWindowsHost: e.target.checked })} /><span />Windows host access</label>
          </div>

          <button className="primary" type="submit" disabled={loading}><Play size={17} /> {loading ? 'Analyzingâ€¦' : 'Analyze build'}</button>
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

      <section className="panel section-panel">
        <div className="panel-title"><div><span className="kicker">03</span><h2>Ingredients</h2></div><span className="muted">Live dependency map</span></div>
        <div className="ingredient-grid">
          {analysis?.ingredients.map((item) => {
            const meta = levelMeta[item.level];
            const TargetIcon = targetMeta[item.target].icon;
            return <article className="ingredient" key={item.id}>
              <div className={`status-dot ${meta.className}`} />
              <div className="ingredient-copy"><div className="ingredient-head"><strong>{item.label}</strong><span>{meta.label}</span></div><p>{item.detail}</p></div>
              <div className="target"><TargetIcon size={15} /> {targetMeta[item.target].label}</div>
            </article>;
          })}
        </div>
      </section>

      <section className="lower-grid">
        <section className="panel section-panel">
          <div className="panel-title"><div><span className="kicker">04</span><h2>Execution route</h2></div><span className="muted">Automatic tool selection</span></div>
          <div className="steps">
            {analysis?.steps.map((step, index) => {
              const TargetIcon = targetMeta[step.target].icon;
              return <div className="step" key={step.id}>
                <div className="step-index">{String(index + 1).padStart(2, '0')}</div>
                <div><strong>{step.title}</strong><p>{step.reason}</p></div>
                <div className="target"><TargetIcon size={15} /> {targetMeta[step.target].label}</div>
              </div>;
            })}
          </div>
        </section>

        <aside className="panel section-panel history-panel">
          <div className="panel-title"><div><span className="kicker">05</span><h2>Recent builds</h2></div><History size={20} /></div>
          <div className="history-list">
            {history.length === 0 && <p className="muted">No saved build analyses yet.</p>}
            {history.map((entry) => <button key={entry.id} className="history-item" onClick={() => { setAnalysis(entry.analysis); setRequest(entry.analysis.request); }}>
              <div><strong>{entry.analysis.request.name || 'Untitled build'}</strong><span>{new Date(entry.createdAt).toLocaleString()}</span></div>
              <span className={entry.analysis.canContinue ? 'mini-ready' : 'mini-blocked'}>{entry.analysis.canContinue ? 'Ready' : 'Blocked'}</span>
            </button>)}
          </div>
        </aside>
      </section>
    </main>
  );
}

