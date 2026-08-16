'use client';

import { ArrowLeft, Check, Fingerprint, LockKeyhole, Package, Rocket, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { targetLabel } from '@/lib/target-platform';
import type { BuilderProject, IntakeView } from './types';

export function ApprovalMode({ intake, project, onBack, onStarted }: { intake: IntakeView; project: BuilderProject; onBack(): void; onStarted(build: unknown): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const brief = intake.brief!;
  const unresolvedDecisions = intake.decisions.filter((decision) => decision.required && !decision.resolution.trim());
  const missingRequiredInputs = (intake.requirements || []).filter((state) => state.requirement.required && !state.satisfied);
  const blocked = unresolvedDecisions.length > 0 || missingRequiredInputs.length > 0 || !brief.visualCoverage.complete || (!intake.design && !intake.approval);
  const approve = async () => {
    setBusy(true); setError('');
    try {
      const approvalResponse = await fetch(`/api/intakes/${intake.intake.id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ briefVersionId: brief.id, buildConfiguration: { deployment: 'local', target: project.buildTarget, needsWindowsHost: true } }) });
      const approval = await approvalResponse.json();
      if (!approvalResponse.ok) throw new Error(approval.error || 'Approval could not be saved');
      const buildResponse = await fetch('/api/builds/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intake_id: intake.intake.id, approval_hash: approval.approval_hash }) });
      const build = await buildResponse.json();
      if (!buildResponse.ok) throw new Error(build.error || 'Your approved build could not start');
      onStarted(build.build);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to approve and start the build'); }
    finally { setBusy(false); }
  };
  return <section className="mode-scene approval-scene">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} />Back to design</button>
    <div className="approval-contract liquid-surface"><div className="approval-seal"><Fingerprint /><span /></div><span className="scene-number">04 / APPROVE &amp; BUILD</span><h1>Ready to<br /><em>start building?</em></h1><p>This is your final check before work begins. Once you approve, Builder handles ordinary implementation choices and recoverable problems without stopping to ask you every time.</p>
      <div className="contract-summary">{intake.requirements?.length ? <div><LockKeyhole /><span><strong>Build inputs & access</strong><small>{missingRequiredInputs.length ? `${missingRequiredInputs.length} required item(s) still missing` : `${intake.requirements.length} required input(s) ready`}</small></span>{missingRequiredInputs.length ? null : <Check />}</div> : null}<div><Package /><span><strong>Build target</strong><small>{targetLabel(project.buildTarget)}</small></span><Check /></div><div><ShieldCheck /><span><strong>Build plan</strong><small>Plan revision {brief.version}</small></span><Check /></div>{intake.design ? <div><ShieldCheck /><span><strong>Visual design</strong><small>Locked design · version {intake.design.version}</small></span><Check /></div> : null}<div><LockKeyhole /><span><strong>Your references</strong><small>{intake.sources.length} files · {brief.visualCoverage.inspectedPages} pages checked</small></span><Check /></div><div><Rocket /><span><strong>Where it runs</strong><small>Privately on this computer</small></span><Check /></div></div>
      <div className="autonomy-contract"><strong>What happens next</strong><p>Builder works through the plan, fixes ordinary failures, runs its checks again when needed, and only comes back to you for something that truly needs your decision.</p></div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <button className="primary-action approve-build" disabled={busy || blocked} onClick={() => void approve()}><span>{busy ? 'Starting your build...' : 'Approve & Build'}</span><Rocket size={17} /></button>
    </div>
  </section>;
}
