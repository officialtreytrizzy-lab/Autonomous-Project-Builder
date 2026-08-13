'use client';

import { ArrowLeft, Check, Fingerprint, LockKeyhole, Rocket, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import type { IntakeView } from './types';

export function ApprovalMode({ intake, onBack, onStarted }: { intake: IntakeView; onBack(): void; onStarted(build: unknown): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const brief = intake.brief!;
  const unresolvedDecisions = intake.decisions.filter((decision) => decision.required && !decision.resolution.trim());
  const blocked = unresolvedDecisions.length > 0 || !brief.visualCoverage.complete;
  const approve = async () => {
    setBusy(true); setError('');
    try {
      const approvalResponse = await fetch(`/api/intakes/${intake.intake.id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ briefVersionId: brief.id, buildConfiguration: { deployment: 'local' } }) });
      const approval = await approvalResponse.json();
      if (!approvalResponse.ok) throw new Error(approval.error || 'Approval could not be recorded');
      const buildResponse = await fetch('/api/builds/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intake_id: intake.intake.id, approval_hash: approval.approval_hash }) });
      const build = await buildResponse.json();
      if (!buildResponse.ok) throw new Error(build.error || 'Approved build could not start');
      onStarted(build.build);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to approve and build'); }
    finally { setBusy(false); }
  };
  return <section className="mode-scene approval-scene">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} />Back to understanding</button>
    <div className="approval-contract liquid-surface"><div className="approval-seal"><Fingerprint /><span /></div><span className="scene-number">03 / APPROVE & BUILD</span><h1>One approval.<br /><em>Then autonomy.</em></h1><p>This records an immutable execution contract. Routine implementation choices and recoverable failures will not interrupt you.</p>
      <div className="contract-summary"><div><ShieldCheck /><span><strong>Scope</strong><small>Build Brief revision {brief.version}</small></span><Check /></div><div><LockKeyhole /><span><strong>Evidence</strong><small>{intake.sources.length} local sources · {brief.visualCoverage.inspectedPages} pages inspected</small></span><Check /></div><div><Rocket /><span><strong>Destination</strong><small>Private local runtime on Computer 2</small></span><Check /></div></div>
      <div className="autonomy-contract"><strong>After approval</strong><p>The Builder continues through recoverable errors, repairs deterministic failures, reruns production gates, and asks only for genuine user-only blockers.</p></div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <button className="primary-action approve-build" disabled={busy || blocked} onClick={() => void approve()}><span>{busy ? 'Recording contract…' : 'Approve & Build'}</span><Rocket size={17} /></button>
    </div>
  </section>;
}
