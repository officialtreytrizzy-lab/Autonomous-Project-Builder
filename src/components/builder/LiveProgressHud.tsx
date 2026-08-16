'use client';

import { Activity, Check, ChevronDown, ChevronUp, Cpu, Eye, Play, Sparkles, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { BuildRecord } from '@/lib/build-store';
import type { BuilderProject, IntakeView, ProjectEvent, UiMode } from './types';

const STAGES: Array<{ mode: UiMode; stepNumber: string; label: string; short: string }> = [
  { mode: 'Compose', stepNumber: '01', label: 'Compose', short: 'Spec' },
  { mode: 'Understand', stepNumber: '02', label: 'Understand', short: 'Plan' },
  { mode: 'Design', stepNumber: '03', label: 'Design', short: 'Visuals' },
  { mode: 'Approve & Build', stepNumber: '04', label: 'Approve', short: 'Lock' },
  { mode: 'Build', stepNumber: '05', label: 'Build & Verify', short: 'Execute' },
];

export function LiveProgressHud({
  mode,
  project,
  intake,
  activeBuild,
  events = [],
  connected = true,
  transport = 'sse',
  onSelectMode,
}: {
  mode: UiMode;
  project: BuilderProject | null;
  intake: IntakeView | null;
  activeBuild: BuildRecord | null;
  events?: ProjectEvent[];
  connected?: boolean;
  transport?: string;
  onSelectMode(mode: UiMode): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Active status detection
  const isBuilding = activeBuild && !['complete', 'failed', 'cancelled', 'blocked'].includes(activeBuild.status);
  const isIntakeRunning = intake && ['extracting', 'rendering', 'inspecting', 'synthesizing'].includes(intake.intake.status);
  const isDesigning = mode === 'Design' && intake?.designSession && intake?.design?.status !== 'approved';
  const isRepairing = activeBuild?.status === 'repairing' || events.some((e) => e.category === 'repair' && !e.category.includes('passed'));
  const isComplete = activeBuild?.status === 'complete' || (mode === 'Approve & Build' && intake?.approval);

  const isActive = Boolean(isBuilding || isIntakeRunning || isDesigning || isRepairing);
  const telemetryDrawerAvailable = mode === 'Understand' || mode === 'Build';
  const drawerOpen = expanded && telemetryDrawerAvailable;

  // Elapsed timer. Reset asynchronously so the effect does not synchronously cascade a render.
  useEffect(() => {
    if (!isActive) {
      const resetTimer = window.setTimeout(() => setElapsed(0), 0);
      return () => window.clearTimeout(resetTimer);
    }
    const timer = window.setInterval(() => setElapsed((previous) => previous + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  const formatElapsed = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Progress computation
  const { progressPercent, activeStepTitle, activeEngine, stageStatuses } = useMemo(() => {
    let pct = 10;
    let title = 'Project draft created. Ready to define specs and references.';
    let engine = 'Standby';

    const stageMap: Record<UiMode, 'pending' | 'active' | 'complete' | 'blocked' | 'repair'> = {
      Compose: 'pending',
      Understand: 'pending',
      Design: 'pending',
      'Approve & Build': 'pending',
      Build: 'pending',
    };

    if (project) {
      stageMap.Compose = 'complete';
      pct = 20;
    }

    if (intake?.brief) {
      stageMap.Understand = 'complete';
      pct = Math.max(pct, 40);
    } else if (intake && ['extracting', 'rendering', 'inspecting', 'synthesizing'].includes(intake.intake.status)) {
      stageMap.Understand = 'active';
      const inspected = intake.brief?.visualCoverage?.inspectedPages || 0;
      const total = intake.brief?.visualCoverage?.totalPages || 1;
      const ratio = total > 0 ? (inspected / total) : 0.5;
      pct = 20 + Math.round(ratio * 20);
      title = `Inspecting multimodal sources (${intake.intake.status})...`;
      engine = 'Gemini 3.7 Vision API';
    }

    if (intake?.design?.status === 'approved') {
      stageMap.Design = 'complete';
      pct = Math.max(pct, 65);
    } else if (mode === 'Design' || intake?.designSession) {
      stageMap.Design = 'active';
      pct = Math.max(pct, 50);
      title = 'Design Studio is creating or analyzing the approved visual source of truth...';
      engine = 'Design Studio';
    }

    if (intake?.approval) {
      stageMap['Approve & Build'] = 'complete';
      pct = Math.max(pct, 75);
    } else if (mode === 'Approve & Build') {
      stageMap['Approve & Build'] = 'active';
      pct = Math.max(pct, 70);
      title = 'Validating immutable contract hashes and required inputs...';
      engine = 'Contract Verifier';
    }

    if (activeBuild) {
      if (activeBuild.status === 'complete') {
        stageMap.Build = 'complete';
        pct = 100;
        title = 'Build and production verification gates passed!';
        engine = 'Computer 2 (Done)';
      } else if (activeBuild.status === 'failed' || activeBuild.status === 'blocked') {
        stageMap.Build = 'blocked';
        pct = 85;
        title = `Build ${activeBuild.status}: ${activeBuild.currentStep || 'Attention required.'}`;
        engine = 'Computer 2 Worker';
      } else if (activeBuild.status === 'repairing') {
        stageMap.Build = 'repair';
        pct = 88;
        title = `Autonomous repair attempt in progress: ${activeBuild.currentStep || 'Applying automated fix...'}`;
        engine = 'Computer 2 Auto-Repair';
      } else {
        stageMap.Build = 'active';
        pct = 80;
        title = activeBuild.currentStep || 'Executing build on Computer 2...';
        engine = 'Computer 2 Worker';
      }
    }

    // Set current active stage in map
    if (stageMap[mode] !== 'complete' && stageMap[mode] !== 'blocked' && stageMap[mode] !== 'repair') {
      stageMap[mode] = 'active';
    }

    return {
      progressPercent: pct,
      activeStepTitle: title,
      activeEngine: engine,
      stageStatuses: stageMap,
    };
  }, [project, intake, mode, activeBuild]);

  const recentEvents = useMemo(() => {
    return [...events].reverse().slice(0, 3);
  }, [events]);

  const statusTone = isComplete
    ? 'complete'
    : isRepairing
    ? 'repair'
    : isBuilding || isIntakeRunning
    ? 'running'
    : isDesigning
    ? 'designing'
    : 'ready';

  return (
    <section className={`live-progress-hud-shell tone-${statusTone} ${drawerOpen ? 'hud-expanded' : ''}`} aria-label="Live Progress HUD">
      {/* Top Laser Progress Bar */}
      <div className="hud-laser-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`hud-laser-fill ${isActive ? 'laser-pulsing' : ''}`}
          style={{ width: `${progressPercent}%` }}
        >
          <span className="hud-laser-spark" />
        </div>
      </div>

      {/* Main HUD Bar */}
      <div className="hud-bar">
        {/* Left: Beacon & Status */}
        <div className="hud-status-group">
          <div className={`hud-beacon ${isActive ? 'beacon-live' : ''}`}>
            <span className="beacon-ring" />
            <span className="beacon-core" />
          </div>
          <div className="hud-status-text">
            <div className="hud-status-heading">
              <strong className="hud-status-label">
                {isBuilding ? 'LIVE BUILD' : isIntakeRunning ? 'UNDERSTANDING' : isDesigning ? 'DESIGN DIRECTOR' : isRepairing ? 'AUTO-REPAIR' : isComplete ? 'VERIFIED' : 'READY'}
              </strong>
              {isActive && (
                <span className="hud-elapsed-pill">
                  <Play size={8} className="hud-play-icon" />
                  {formatElapsed(elapsed)}
                </span>
              )}
            </div>
            <p className="hud-step-ticker" title={activeStepTitle}>
              {activeStepTitle}
            </p>
          </div>
        </div>

        {/* Center: Stage Progress Stepper */}
        <nav className="hud-stages-track" aria-label="Lifecycle progression">
          {STAGES.map((s, idx) => {
            const st = stageStatuses[s.mode];
            const isCurrent = mode === s.mode;
            return (
              <button
                key={s.mode}
                type="button"
                className={`hud-stage-pill stage-${st} ${isCurrent ? 'stage-current' : ''}`}
                onClick={() => onSelectMode(s.mode)}
                title={`${s.stepNumber} ${s.label} (${st})`}
              >
                <span className="hud-stage-index">
                  {st === 'complete' ? <Check size={9} /> : s.stepNumber}
                </span>
                <span className="hud-stage-name">{s.short}</span>
                {idx < STAGES.length - 1 && <span className="hud-stage-connector" />}
              </button>
            );
          })}
        </nav>

        {/* Right: Telemetry Badges & Expand Trigger */}
        <div className="hud-telemetry-group">
          <div className="hud-engine-badge" title={`Active engine: ${activeEngine}`}>
            {activeEngine.includes('Gemini') ? (
              <Sparkles size={11} className="engine-icon-gemini" />
            ) : activeEngine.includes('Computer 2') ? (
              <Cpu size={11} className="engine-icon-computer" />
            ) : activeEngine.includes('Vision') ? (
              <Eye size={11} className="engine-icon-vision" />
            ) : (
              <Zap size={11} className="engine-icon-ready" />
            )}
            <span>{activeEngine}</span>
          </div>

          <div className="hud-percentage-pill">
            <span>{progressPercent}%</span>
          </div>

          {telemetryDrawerAvailable && (
            <button
              type="button"
              className="hud-toggle-button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={drawerOpen}
              aria-label={drawerOpen ? 'Collapse telemetry HUD' : 'Expand telemetry HUD'}
            >
              <Activity size={12} />
              <span>HUD</span>
              {drawerOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
          )}
        </div>
      </div>

      {/* Expandable Mission-Control HUD Drawer */}
      {drawerOpen && (
        <div className="hud-drawer-panel glass-edge" role="region" aria-label="Detailed Live Telemetry">
          <div className="hud-drawer-grid">
            {/* Left: Overall Progress Gauge */}
            <div className="hud-gauge-card">
              <div className="hud-radial-gauge">
                <svg viewBox="0 0 100 100" className="gauge-svg">
                  <circle cx="50" cy="50" r="42" className="gauge-track" />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    className="gauge-progress"
                    style={{
                      strokeDasharray: 264,
                      strokeDashoffset: 264 - (264 * progressPercent) / 100,
                    }}
                  />
                </svg>
                <div className="gauge-center">
                  <strong>{progressPercent}%</strong>
                  <small>COMPLETED</small>
                </div>
              </div>
              <div className="gauge-meta">
                <span>Current Mode: <strong>{mode}</strong></span>
                <span>Connection: <strong>{connected ? `Live (${transport.toUpperCase()})` : 'Reconnecting'}</strong></span>
                <span>Events Streamed: <strong>{events.length}</strong></span>
              </div>
            </div>

            {/* Middle: Active Stages & Verification */}
            <div className="hud-details-card">
              <div className="hud-card-heading">
                <span>Autonomous Lifecycle</span>
                <strong>Stage Verification</strong>
              </div>
              <ul className="hud-stage-breakdown">
                <li>
                  <span className={`stage-dot ${stageStatuses.Compose}`} />
                  <strong>01 Specification & Target</strong>
                  <small>{project ? project.name : 'Drafting'}</small>
                </li>
                <li>
                  <span className={`stage-dot ${stageStatuses.Understand}`} />
                  <strong>02 Multimodal Grounding</strong>
                  <small>{intake?.brief ? `${intake.brief.visualCoverage.inspectedPages} pages inspected` : 'Awaiting files'}</small>
                </li>
                <li>
                  <span className={`stage-dot ${stageStatuses.Design}`} />
                  <strong>03 Design Studio · Visual Source of Truth</strong>
                  <small>{intake?.design?.status === 'approved' ? `Contract v${intake.design.version} locked` : 'Visual studio'}</small>
                </li>
                <li>
                  <span className={`stage-dot ${stageStatuses['Approve & Build']}`} />
                  <strong>04 Immutable Build Contract</strong>
                  <small>{intake?.approval ? 'Signed & sealed' : 'Pending lock'}</small>
                </li>
                <li>
                  <span className={`stage-dot ${stageStatuses.Build}`} />
                  <strong>05 Execution & Production Gates</strong>
                  <small>{activeBuild ? `${activeBuild.status} (${activeBuild.verification.filter((v) => v.status === 'passed').length}/${activeBuild.verification.length || 5} gates)` : 'Ready to launch'}</small>
                </li>
              </ul>
            </div>

            {/* Right: Live Event Micro-Feed */}
            <div className="hud-events-card">
              <div className="hud-card-heading">
                <span>Live Event Stream</span>
                <strong>Recent Project Actions</strong>
              </div>
              <div className="hud-event-list">
                {recentEvents.length > 0 ? (
                  recentEvents.map((evt) => (
                    <article key={evt.eventId} className={`hud-mini-event severity-${evt.severity}`}>
                      <span className="hud-mini-seq">#{String(evt.sequence).padStart(3, '0')}</span>
                      <div className="hud-mini-copy">
                        <strong>{evt.humanMessage}</strong>
                        <small>{evt.stage.replaceAll('-', ' ')} | {new Date(evt.timestamp).toLocaleTimeString()}</small>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="hud-no-events">Live stream events will broadcast here as execution runs.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
