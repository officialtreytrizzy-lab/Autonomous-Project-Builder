'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Command, LockKeyhole, Moon, Sun } from 'lucide-react';

import type { BuildRecord } from '@/lib/build-store';
import { ApprovalMode } from '@/components/builder/ApprovalMode';
import { BuildMode } from '@/components/builder/BuildMode';
import { ComposeMode } from '@/components/builder/ComposeMode';
import { DesignMode } from '@/components/builder/DesignMode';
import { FirstRunWelcome } from '@/components/builder/FirstRunWelcome';
import { LiveProgressHud } from '@/components/builder/LiveProgressHud';
import { ProjectRail } from '@/components/builder/ProjectRail';
import { SystemHealth } from '@/components/builder/SystemHealth';
import { UnderstandMode } from '@/components/builder/UnderstandMode';
import type { BuilderProject, IntakeView, UiMode } from '@/components/builder/types';
import { useProjectEvents } from '@/hooks/useProjectEvents';

function modeFor(project: BuilderProject | null, build: BuildRecord | null, intake?: IntakeView | null): UiMode {
  if (build && build.projectId === project?.id) return 'Build';
  if (!project || project.state === 'draft') return 'Compose';
  if (project.state === 'understanding') return 'Understand';
  const hasPendingUserInput = Boolean(intake?.decisions.some((decision) => decision.required && !decision.resolution.trim()) || intake?.requirements?.some((state) => state.requirement.required && !state.satisfied));
  if (project.state === 'awaiting-approval') return hasPendingUserInput ? 'Understand' : intake?.design?.status === 'approved' ? 'Approve & Build' : 'Design';
  if (project.state === 'approved') return 'Approve & Build';
  return 'Build';
}

export default function Home() {
  const [projects, setProjects] = useState<BuilderProject[]>([]);
  const [selected, setSelected] = useState<BuilderProject | null>(null);
  const [intake, setIntake] = useState<IntakeView | null>(null);
  const [builds, setBuilds] = useState<BuildRecord[]>([]);
  const [activeBuild, setActiveBuild] = useState<BuildRecord | null>(null);
  const [mode, setMode] = useState<UiMode>('Compose');
  const [firstRun, setFirstRun] = useState(false);
  const [composeIntent, setComposeIntent] = useState<'new' | 'existing'>('new');
  const [reconciled, setReconciled] = useState(false);
  const [fatal, setFatal] = useState('');
  const [theme, setTheme] = useState<'night' | 'light'>('night');
  const stageRef = useRef<HTMLDivElement>(null);
  const userIntentRef = useRef(0);
  const restoreStartedRef = useRef(false);
  const refreshSequenceRef = useRef(0);

  const { events, connected, transport } = useProjectEvents(selected?.id || '');

  const refreshProjects = useCallback(async () => {
    const response = await fetch('/api/projects', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to restore projects');
    const payload = await response.json() as { projects: BuilderProject[] };
    setProjects(payload.projects);
    return payload.projects;
  }, []);

  const refreshBuilds = useCallback(async () => {
    const response = await fetch('/api/builds', { cache: 'no-store' });
    if (!response.ok) return [];
    const payload = await response.json() as { builds: BuildRecord[] };
    setBuilds(payload.builds);
    return payload.builds;
  }, []);

  const refreshIntake = useCallback(async (intakeId?: string, expectedIntent = userIntentRef.current, reconcile = true) => {
    if (!intakeId) { setIntake(null); return null; }
    const sequence = ++refreshSequenceRef.current;
    const response = await fetch(`/api/intakes/${encodeURIComponent(intakeId)}?reconcile=${reconcile ? '1' : '0'}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json() as IntakeView;
    if (payload.brief) {
      const briefResponse = await fetch(`/api/intakes/${encodeURIComponent(intakeId)}/brief`, { cache: 'no-store' });
      if (briefResponse.ok) {
        const briefPayload = await briefResponse.json();
        payload.brief = briefPayload;
        payload.decisions = briefPayload.decisions || payload.decisions;
        payload.citations = briefPayload.citations || [];
      }
    }
    if (userIntentRef.current !== expectedIntent || sequence !== refreshSequenceRef.current) return null;
    setIntake(payload);
    return payload;
  }, []);

  const selectProject = useCallback(async (project: BuilderProject, knownBuilds = builds, reconcileIntake = true) => {
    const expectedIntent = userIntentRef.current;
    setSelected(project);
    const associatedBuild = knownBuilds.find((build) => build.projectId === project.id) || null;
    setActiveBuild(associatedBuild);
    const currentIntake = await refreshIntake(project.currentIntakeId, expectedIntent, reconcileIntake);
    if (userIntentRef.current !== expectedIntent) return;
    setMode(modeFor(project, associatedBuild, currentIntake));
  }, [builds, refreshIntake]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === 'night' ? 'light' : 'night');

  useEffect(() => {
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    const restore = async () => {
      const intentAtStart = userIntentRef.current;
      try {
        void Promise.allSettled([
          fetch('/api/builds/resume', { method: 'POST' }),
          fetch('/api/intakes/resume', { method: 'POST' }),
        ]);
        const [restoredProjects, restoredBuilds] = await Promise.all([refreshProjects(), refreshBuilds()]);
        const active = restoredBuilds.find((build) => !['complete', 'failed', 'cancelled', 'blocked'].includes(build.status)) || restoredBuilds[0];
        const project = (active && restoredProjects.find((item) => item.id === active.projectId)) || restoredProjects[0] || null;
        if (project && userIntentRef.current === intentAtStart) await selectProject(project, restoredBuilds, false);
        if (!restoredProjects.length && window.localStorage.getItem('autonomous-builder-welcome-seen') !== '1') setFirstRun(true);
      } catch (error) { setFatal(error instanceof Error ? error.message : 'Unable to recover your saved work'); }
      finally { setReconciled(true); }
    };
    void restore();
  }, [refreshBuilds, refreshProjects, selectProject]);

  useEffect(() => {
    if (!intake || !['queued', 'extracting', 'rendering', 'inspecting', 'synthesizing', 'blocked'].includes(intake.intake.status)) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const next = await refreshIntake(intake.intake.id);
      if (next?.brief) {
        const nextProjects = await refreshProjects();
        const project = nextProjects.find((item) => item.id === next.intake.projectId);
        if (project) setSelected(project);
      }
      if (!cancelled) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 250);
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [intake, refreshIntake, refreshProjects]);

  useEffect(() => { stageRef.current?.focus({ preventScroll: true }); }, [mode, firstRun]);

  const composed = async (projectId: string, intakeId: string) => {
    const nextProjects = await refreshProjects();
    const created = nextProjects.find((item) => item.id === projectId) || null;
    if (created) await selectProject(created);
    setMode('Understand');
    await refreshIntake(intakeId);
  };

  const started = async (build: unknown) => {
    setActiveBuild((build as { build?: BuildRecord })?.build || (build as BuildRecord));
    setMode('Build');
    await refreshBuilds();
  };

  const updateBuild = async (build: BuildRecord) => {
    setActiveBuild(build);
    await refreshBuilds();
  };

  const beginFirstRun = (intent: 'new' | 'existing') => {
    setComposeIntent(intent);
    setFirstRun(false);
    setSelected(null);
    setIntake(null);
    setActiveBuild(null);
    setMode('Compose');
    window.localStorage.setItem('autonomous-builder-welcome-seen', '1');
  };

  const beginNewProject = () => {
    userIntentRef.current += 1;
    setComposeIntent('new');
    setFirstRun(false);
    setSelected(null);
    setIntake(null);
    setActiveBuild(null);
    setMode('Compose');
  };

  const requestMode = (next: UiMode) => {
    if (firstRun && next === 'Compose') { beginFirstRun('new'); return; }
    if (!selected && next !== 'Compose') return;
    const missingRequiredInputs = intake?.requirements?.some((state) => state.requirement.required && !state.satisfied) ?? false;
    if (next === 'Design' && (!intake?.brief || missingRequiredInputs || intake.decisions.some((decision) => decision.required && !decision.resolution.trim()))) return;
    if (next === 'Approve & Build' && (!intake?.brief || missingRequiredInputs || (!intake.design && !intake.approval) || intake.decisions.some((decision) => decision.required && !decision.resolution.trim()))) return;
    if (next === 'Build' && !activeBuild) return;
    setMode(next);
  };

  return <main className="builder-environment">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <ProjectRail projects={projects} selectedId={selected?.id} activeMode={mode} onSelect={(project) => { setFirstRun(false); userIntentRef.current += 1; void selectProject(project); }} onNew={beginNewProject} onMode={requestMode} />
    <section className="builder-main">
      <header className="builder-topline"><div className="desktop-page-context"><span>Autonomous Project Builder</span><strong>{firstRun ? 'Home' : mode}</strong></div><div className="topline-actions"><div className="privacy-mark"><LockKeyhole size={13} /><span>Private on this computer</span></div><button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'night' ? 'light' : 'night'} mode`}>{theme === 'night' ? <Sun size={13} /> : <Moon size={13} />}<span>{theme === 'night' ? 'Light' : 'Night'}</span></button><SystemHealth /></div></header>

      {/* Cool Live Progress HUD across the app */}
      {reconciled && !firstRun ? (
        <LiveProgressHud
          mode={mode}
          project={selected}
          intake={intake}
          activeBuild={activeBuild}
          events={events}
          connected={connected}
          transport={transport}
          onSelectMode={requestMode}
        />
      ) : null}

      <div className="state-ribbon" aria-live="polite">
        {firstRun ? <><span>Ready when you are</span><i />Choose how you want to start<em>Everything stays local by default</em></> : <><span>{selected?.name || 'New project'}</span><i />Project status · <strong>{selected?.state || 'not started'}</strong><em>{reconciled ? 'Your work is saved' : 'Restoring your work'}</em></>}
      </div>
      <div ref={stageRef} tabIndex={-1} className="mode-stage">
        {!reconciled ? <section className="recovery-scene"><div className="recovery-rings"><span /><span /><span /></div><h1>Opening your Builder</h1><p>Restoring your saved projects and checking local services.</p></section> : null}
        {reconciled && firstRun ? <FirstRunWelcome onStart={beginFirstRun} /> : null}
        {reconciled && !firstRun && mode === 'Compose' ? <ComposeMode key={composeIntent} onReady={composed} preferredExisting={composeIntent === 'existing'} /> : null}
        {reconciled && mode === 'Understand' && intake ? <UnderstandMode intake={intake} onRefresh={() => refreshIntake(intake.intake.id).then(() => undefined)} onDesign={() => setMode('Design')} /> : null}
        {reconciled && mode === 'Design' && intake?.brief ? <DesignMode intake={intake} onBack={() => setMode('Understand')} onRefresh={() => refreshIntake(intake.intake.id).then(() => undefined)} onApproved={() => setMode('Approve & Build')} /> : null}
        {reconciled && mode === 'Approve & Build' && intake?.brief ? <ApprovalMode intake={intake} project={selected!} onBack={() => setMode(intake.design ? 'Design' : 'Understand')} onStarted={started} /> : null}
        {mode === 'Build' && selected ? <BuildMode projectId={selected.id} initialBuild={activeBuild} reconciled={reconciled} onBuild={updateBuild} /> : null}
      </div>
      {fatal ? <div className="fatal-banner" role="alert">{fatal}</div> : null}
      <footer className="desktop-footer"><span><Command size={12} />Autonomous Builder</span><span>Describe → Review → Approve → Build → Verify</span></footer>
    </section>
    {/* LivingBuildSpine is mounted by BuildMode only after persisted state reconciles. */}
  </main>;
}
