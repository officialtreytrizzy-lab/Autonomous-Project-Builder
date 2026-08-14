'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Command, LockKeyhole } from 'lucide-react';

import type { BuildRecord } from '@/lib/build-store';
import { ApprovalMode } from '@/components/builder/ApprovalMode';
import { BuildMode } from '@/components/builder/BuildMode';
import { ComposeMode } from '@/components/builder/ComposeMode';
import { ProjectRail } from '@/components/builder/ProjectRail';
import { SystemHealth } from '@/components/builder/SystemHealth';
import { UnderstandMode } from '@/components/builder/UnderstandMode';
import type { BuilderProject, IntakeView, UiMode } from '@/components/builder/types';

function modeFor(project: BuilderProject | null, build: BuildRecord | null): UiMode {
  if (build && build.projectId === project?.id) return 'Build';
  if (!project || project.state === 'draft') return 'Compose';
  if (['understanding', 'awaiting-approval'].includes(project.state)) return 'Understand';
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
  const [reconciled, setReconciled] = useState(false);
  const [fatal, setFatal] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const userIntentRef = useRef(0);
  const restoreStartedRef = useRef(false);
  const refreshSequenceRef = useRef(0);

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
    await refreshIntake(project.currentIntakeId, expectedIntent, reconcileIntake);
    if (userIntentRef.current !== expectedIntent) return;
    setMode(modeFor(project, associatedBuild));
  }, [builds, refreshIntake]);

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
      } catch (error) { setFatal(error instanceof Error ? error.message : 'Unable to recover persisted state'); }
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

  useEffect(() => { stageRef.current?.focus({ preventScroll: true }); }, [mode]);

  const composed = async (projectId: string, intakeId: string) => {
    const list = await refreshProjects();
    const project = list.find((item) => item.id === projectId);
    if (project) setSelected(project);
    await refreshIntake(intakeId);
    setMode('Understand');
  };

  const started = (value: unknown) => {
    const build = value as BuildRecord;
    setActiveBuild(build);
    setBuilds((current) => [build, ...current.filter((item) => item.id !== build.id)]);
    if (selected) setSelected({ ...selected, state: 'building', activeBuildId: build.id });
    setMode('Build');
  };

  const updateBuild = useCallback((build: BuildRecord) => {
    setActiveBuild(build);
    setBuilds((current) => current.map((item) => item.id === build.id ? build : item));
  }, []);

  const requestMode = (next: UiMode) => {
    if (!selected && next !== 'Compose') return;
    if (next === 'Approve & Build' && (!intake?.brief || intake.decisions.some((decision) => decision.required && !decision.resolution.trim()))) return;
    if (next === 'Build' && !activeBuild) return;
    setMode(next);
  };

  return <main className="builder-environment">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <ProjectRail projects={projects} selectedId={selected?.id} activeMode={mode} onSelect={(project) => { userIntentRef.current += 1; void selectProject(project); }} onNew={() => { userIntentRef.current += 1; setSelected(null); setIntake(null); setActiveBuild(null); setMode('Compose'); }} onMode={requestMode} />
    <section className="builder-main">
      <header className="builder-topline"><div className="privacy-mark"><LockKeyhole size={13} /><span>Private local workspace</span></div><SystemHealth /></header>
      <div className="state-ribbon" aria-live="polite"><span>{selected?.name || 'New project'}</span><i />Project state · <strong>{selected?.state || 'draft'}</strong><em>{reconciled ? 'Persisted state reconciled' : 'Recovering persisted state'}</em></div>
      <div ref={stageRef} tabIndex={-1} className="mode-stage">
        {!reconciled ? <section className="recovery-scene"><div className="recovery-rings"><span /><span /><span /></div><h1>Recovering persisted state</h1><p>Reconnecting to local project, intake, job, and event records.</p></section> : null}
        {reconciled && mode === 'Compose' ? <ComposeMode onReady={composed} /> : null}
        {reconciled && mode === 'Understand' && intake ? <UnderstandMode intake={intake} onRefresh={() => refreshIntake(intake.intake.id).then(() => undefined)} onApproval={() => setMode('Approve & Build')} /> : null}
        {reconciled && mode === 'Approve & Build' && intake?.brief ? <ApprovalMode intake={intake} onBack={() => setMode('Understand')} onStarted={started} /> : null}
        {mode === 'Build' && selected ? <BuildMode projectId={selected.id} initialBuild={activeBuild} reconciled={reconciled} onBuild={updateBuild} /> : null}
      </div>
      {fatal ? <div className="fatal-banner" role="alert">{fatal}</div> : null}
      <footer className="desktop-footer"><span><Command size={12} />Autonomous Builder</span><span>Sources → Evidence → Understanding → Approval Contract → Execution → Verification</span></footer>
    </section>
    {/* LivingBuildSpine is mounted by BuildMode only after persisted state reconciles. */}
  </main>;
}
