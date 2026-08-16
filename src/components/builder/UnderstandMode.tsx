'use client';

import { ArrowRight, CheckCircle2, Eye, FileText, LoaderCircle, Quote, Sparkles, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { EvidenceViewer } from './EvidenceViewer';
import { SourceManager } from './SourceManager';
import { RequirementsPanel } from './RequirementsPanel';
import type { Citation, IntakeView, PublicSource } from './types';

function BriefSection({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return <section className="brief-section"><h3>{title}</h3><ul>{values.map((value) => <li key={value}>{value}</li>)}</ul></section>;
}

export function UnderstandMode({ intake, onRefresh, onDesign }: { intake: IntakeView; onRefresh(): Promise<void>; onDesign(): void }) {
  const [citation, setCitation] = useState<Citation | null>(null);
  const [answering, setAnswering] = useState('');
  const unresolved = intake.decisions.filter((decision) => decision.required && !decision.resolution.trim());
  const requirements = intake.requirements || [];
  const missingRequiredInputs = requirements.filter((state) => state.requirement.required && !state.satisfied);
  const brief = intake.brief;
  const resolve = async (decisionId: string, resolution: string) => {
    if (!resolution.trim()) return;
    setAnswering(decisionId);
    await fetch(`/api/intakes/${intake.intake.id}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decisionId, resolution }) });
    setAnswering(''); await onRefresh();
  };
  if (!brief) return (
    <section className="mode-scene understand-loading">
      <div className="understanding-orbit">
        <LoaderCircle />
        <span />
        <span />
      </div>
      <span className="scene-number">02 / REVIEW</span>
      <h1>Reading your files.<br /><em>Building the plan.</em></h1>
      <p>{intake.intake.status === 'blocked' ? 'Builder paused safely and is waiting to recover this step.' : 'Builder is reading the text and visuals you provided, then turning them into a clear build plan.'}</p>

      {/* Live Ingestion Progress Radar */}
      <div className="understand-live-progress-card glass-edge">
        <div className="understand-radar-header">
          <span className="radar-status-pill">
            <span className="radar-live-light" />
            {intake.intake.status.toUpperCase()}
          </span>
          <small>{intake.sources.length} source{intake.sources.length === 1 ? '' : 's'} queued for multimodal ingestion</small>
        </div>
        <div className="understand-stage-steps">
          <div className="understand-step active">
            <FileText size={13} />
            <span>Document OCR & Extraction</span>
          </div>
          <div className="understand-step-sep" />
          <div className="understand-step active">
            <Eye size={13} />
            <span>Visual Evidence Inactive/Inspect</span>
          </div>
          <div className="understand-step-sep" />
          <div className="understand-step active">
            <Sparkles size={13} />
            <span>Brief Synthesis</span>
          </div>
        </div>
      </div>

      <div className="truth-note"><CheckCircle2 size={15} />You will review the plan before any build starts.</div>
    </section>
  );
  return <section className="mode-scene understand-scene">
    <div className="scene-copy"><span className="scene-number">02 / REVIEW</span><h1>Here&apos;s what Builder<br /><em>understood.</em></h1><p>Check the plan before anything changes. If Builder found a real conflict or missing decision, it will ask you instead of guessing.</p></div>
    <div className="understand-grid">
      <article className="brief-document liquid-surface">
        <header><div><span>Build plan · revision {brief.version}</span><h2>{brief.content.outcome}</h2></div><span className={brief.visualCoverage.complete ? 'coverage complete' : 'coverage incomplete'}>{brief.visualCoverage.inspectedPages}/{brief.visualCoverage.totalPages} pages checked</span></header>
        <BriefSection title="Who this is for" values={brief.content.users} /><BriefSection title="What people need to do" values={brief.content.flows} /><BriefSection title="Requirements" values={brief.content.requirements} /><BriefSection title="Look & feel" values={brief.content.designDirection} /><BriefSection title="Data & connections" values={brief.content.dataAndIntegrations} /><BriefSection title="Not included" values={brief.content.exclusions} /><BriefSection title="How Builder will verify it" values={brief.content.acceptanceTests} /><BriefSection title="Assumptions" values={brief.content.assumptions} />
        {intake.citations?.length ? <section className="citation-strip"><h3><Quote size={14} />Where this came from</h3><div>{intake.citations.slice(0, 12).map((item) => <button key={item.evidenceId} onClick={() => setCitation(item)}><Eye size={12} />{intake.sources.find((source) => source.sourceId === item.sourceId)?.originalFilename || 'Source'}{item.page ? ` · p. ${item.page}` : ''} · {item.kind}</button>)}</div></section> : null}
      </article>
      <aside className="understand-side">
        <SourceManager intakeId={intake.intake.id} sources={intake.sources} onChanged={onRefresh} onView={(source) => setCitation(intake.citations?.find((item) => item.sourceId === source.sourceId) || null)} />
        <RequirementsPanel intakeId={intake.intake.id} requirements={requirements} onChanged={onRefresh} />
        {unresolved.length ? <section className="decision-well"><div className="section-heading"><div><span>Need your answer</span><h2>A few things to confirm</h2></div><TriangleAlert size={18} /></div>{unresolved.map((decision) => <form key={decision.decisionId} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void resolve(decision.decisionId, String(data.get('resolution') || '')); }}><p>{decision.question}</p><textarea name="resolution" required placeholder="Tell Builder what you want here..." /><button disabled={answering === decision.decisionId}>Save answer</button></form>)}</section> : missingRequiredInputs.length ? <div className="requirements-block-note"><TriangleAlert size={15} /><span>Provide every required build input above before design approval can continue.</span></div> : <button className="primary-action approval-next" disabled={!brief.visualCoverage.complete} onClick={onDesign}><span>Open design studio</span><ArrowRight size={17} /></button>}
      </aside>
    </div>
    <EvidenceViewer intakeId={intake.intake.id} citation={citation} source={intake.sources.find((source: PublicSource) => source.sourceId === citation?.sourceId)} onClose={() => setCitation(null)} />
  </section>;
}
