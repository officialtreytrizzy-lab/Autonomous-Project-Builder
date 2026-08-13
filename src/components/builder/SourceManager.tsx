'use client';

import { Eye, FileText, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import type { PublicSource } from './types';

export function SourceManager({ intakeId, sources, onChanged, onView }: {
  intakeId: string;
  sources: PublicSource[];
  onChanged(): Promise<void>;
  onView(source: PublicSource): void;
}) {
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState('');
  const [busyId, setBusyId] = useState('');
  const replace = async (file?: File) => {
    if (!file || !replaceId) return;
    setBusyId(replaceId);
    const form = new FormData(); form.set('file', file, file.name);
    await fetch(`/api/intakes/${intakeId}/sources/${replaceId}`, { method: 'PUT', body: form });
    setBusyId(''); setReplaceId(''); await onChanged();
  };
  const remove = async (source: PublicSource) => {
    if (!window.confirm(`Delete the locally retained original “${source.originalFilename}”? Its Build Brief evidence remains, but the original will be marked unavailable.`)) return;
    setBusyId(source.sourceId);
    await fetch(`/api/intakes/${intakeId}/sources/${source.sourceId}`, { method: 'DELETE' });
    setBusyId(''); await onChanged();
  };
  const openFolder = () => void fetch('/api/builds/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intake_id: intakeId }) });
  return <section className="source-manager" aria-labelledby="sources-title">
    <div className="section-heading"><div><span>Local evidence</span><h2 id="sources-title">Source manifest</h2></div><button className="quiet-button" onClick={openFolder}><FolderOpen size={14} />Open folder</button></div>
    <input ref={replaceInput} hidden type="file" accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp" onChange={(event) => void replace(event.target.files?.[0])} />
    <div className="source-lines">{sources.map((source) => <article key={source.sourceId} className={source.availability === 'deleted' ? 'source-line unavailable' : 'source-line'}>
      <span className="source-icon"><FileText size={16} /></span><div><strong>{source.originalFilename}</strong><small>Revision {source.revision} · {source.inspectedPageCount || 0}/{source.pageCount || '—'} pages inspected · {source.availability === 'deleted' ? 'original unavailable' : 'retained locally'}</small></div>
      <span className={`source-state source-${source.processingStatus}`}>{busyId === source.sourceId ? 'working' : source.processingStatus}</span>
      <div className="source-actions"><button disabled={source.availability === 'deleted'} onClick={() => onView(source)} aria-label={`View ${source.originalFilename}`}><Eye size={14} /></button><button disabled={source.availability === 'deleted'} onClick={() => { setReplaceId(source.sourceId); replaceInput.current?.click(); }} aria-label={`Replace ${source.originalFilename}`}><RefreshCw size={14} /></button><button disabled={source.availability === 'deleted'} onClick={() => void remove(source)} aria-label={`Delete ${source.originalFilename}`}><Trash2 size={14} /></button></div>
    </article>)}</div>
  </section>;
}
