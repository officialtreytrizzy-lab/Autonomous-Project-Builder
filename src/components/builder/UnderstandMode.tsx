'use client';

import { ArrowRight, CheckCircle2, Eye, LoaderCircle, Quote, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { EvidenceViewer } from './EvidenceViewer';
import { SourceManager } from './SourceManager';
import type { Citation, IntakeView, PublicSource } from './types';

function BriefSection({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return <section className="brief-section"><h3>{title}</h3><ul>{values.map((value) => <li key={value}>{value}</li>)}</ul></section>;
}

export function UnderstandMode({ intake, onRefresh, onApproval }: { intake: IntakeView; onRefresh(): Promise<void>; onApproval(): void }) {
  const [citation, setCitation] = useState<Citation | null>(null);
  const [answering, setAnswering] = useState('');
  const unresolved = intake.decisions.filter((decision) => decision.required && !decision.resolution.trim());
  const brief = intake.brief;
  const resolve = async (decisionId: string, resolution: string) => {
    if (!resolution.trim()) return;
    setAnswering(decisionId);
    await fetch(`/api/intakes/${intake.intake.id}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decisionId, resolution }) });
    setAnswering(''); await onRefresh();
  };
  if (!brief) return <section className="mode-scene understand-loading"><div className="understanding-orbit"><LoaderCircle /><span /><span /></div><span className="scene-number">02 / UNDERSTAND</span><h1>Reading every source.<br /><em>Seeing every page.</em></h1><p>{intake.intake.status === 'blocked' ? 'Local document understanding paused at a recoverable checkpoint.' : 'Extracting text, inspecting visuals, connecting evidence, and preparing the Build Brief.'}</p><div className="truth-note"><CheckCircle2 size={15} />No approval appears until visual coverage is complete.</div></section>;
  return <section className="mode-scene understand-scene">
    <div className="scene-copy"><span className="scene-number">02 / UNDERSTAND</span><h1>A source-grounded<br /><em>Build Brief.</em></h1><p>Review what the Builder understood. Text and visual evidence carry equal weight; conflicts are never silently guessed.</p></div>
    <div className="understand-grid">
      <article className="brief-document liquid-surface">
        <header><div><span>Build Brief · revision {brief.version}</span><h2>{brief.content.outcome}</h2></div><span className={brief.visualCoverage.complete ? 'coverage complete' : 'coverage incomplete'}>{brief.visualCoverage.inspectedPages}/{brief.visualCoverage.totalPages} pages</span></header>
        <BriefSection title="Who this is for" values={brief.content.users} /><BriefSection title="Critical flows" values={brief.content.flows} /><BriefSection title="Requirements" values={brief.content.requirements} /><BriefSection title="Design direction" values={brief.content.designDirection} /><BriefSection title="Data & integrations" values={brief.content.dataAndIntegrations} /><BriefSection title="Explicit exclusions" values={brief.content.exclusions} /><BriefSection title="Acceptance tests" values={brief.content.acceptanceTests} /><BriefSection title="Assumptions" values={brief.content.assumptions} />
        {intake.citations?.length ? <section className="citation-strip"><h3><Quote size={14} />Evidence</h3><div>{intake.citations.slice(0, 12).map((item) => <button key={item.evidenceId} onClick={() => setCitation(item)}><Eye size={12} />{intake.sources.find((source) => source.sourceId === item.sourceId)?.originalFilename || 'Source'}{item.page ? ` · p. ${item.page}` : ''} · {item.kind}</button>)}</div></section> : null}
      </article>
      <aside className="understand-side">
        <SourceManager intakeId={intake.intake.id} sources={intake.sources} onChanged={onRefresh} onView={(source) => setCitation(intake.citations?.find((item) => item.sourceId === source.sourceId) || null)} />
        {unresolved.length ? <section className="decision-well"><div className="section-heading"><div><span>Genuine uncertainty</span><h2>Resolve conflicts</h2></div><TriangleAlert size={18} /></div>{unresolved.map((decision) => <form key={decision.decisionId} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void resolve(decision.decisionId, String(data.get('resolution') || '')); }}><p>{decision.question}</p><textarea name="resolution" required placeholder="State the intended requirement…" /><button disabled={answering === decision.decisionId}>Resolve decision</button></form>)}</section> : <button className="primary-action approval-next" disabled={!brief.visualCoverage.complete} onClick={onApproval}><span>Review approval contract</span><ArrowRight size={17} /></button>}
      </aside>
    </div>
    <EvidenceViewer intakeId={intake.intake.id} citation={citation} source={intake.sources.find((source: PublicSource) => source.sourceId === citation?.sourceId)} onClose={() => setCitation(null)} />
  </section>;
}
