'use client';

import { ExternalLink, X } from 'lucide-react';
import Image from 'next/image';

import type { Citation, PublicSource } from './types';

export function EvidenceViewer({ intakeId, citation, source, onClose }: {
  intakeId: string;
  citation: Citation | null;
  source?: PublicSource;
  onClose(): void;
}) {
  if (!citation) return null;
  const imageUrl = citation.page && citation.artifactAvailable
    ? `/api/intakes/${intakeId}/sources/${citation.sourceId}/pages/${citation.page}`
    : '';
  return <div className="evidence-backdrop" role="dialog" aria-modal="true" aria-labelledby="evidence-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="evidence-viewer liquid-surface">
      <header><div><span>Source evidence</span><h2 id="evidence-title">{source?.originalFilename || 'Document'} · {citation.page ? `page ${citation.page}` : citation.kind}</h2></div><button onClick={onClose} aria-label="Close evidence"><X /></button></header>
      <div className="evidence-canvas">
        {imageUrl ? <div className="evidence-image-wrap"><Image src={imageUrl} alt={`Rendered evidence page ${citation.page}`} width={1200} height={1600} unoptimized />{citation.region ? <span className="evidence-region" style={{ left: `${citation.region.x * 100}%`, top: `${citation.region.y * 100}%`, width: `${citation.region.width * 100}%`, height: `${citation.region.height * 100}%` }} /> : null}</div> : <div className="evidence-unavailable">The original page image is no longer available. The approved, extracted evidence remains below.</div>}
      </div>
      <footer><div><span>{citation.kind}</span><p>{citation.content}</p>{citation.relationships.map((relationship) => <small key={relationship}>{relationship}</small>)}</div>{source?.availability === 'available' ? <a href={`/api/intakes/${intakeId}/sources/${source.sourceId}`} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open original</a> : null}</footer>
    </section>
  </div>;
}
