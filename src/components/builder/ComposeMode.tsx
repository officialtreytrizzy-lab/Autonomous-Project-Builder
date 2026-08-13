'use client';

import { ArrowRight, FileImage, FileText, LockKeyhole, Paperclip, UploadCloud, X } from 'lucide-react';
import { DragEvent, useRef, useState } from 'react';

const accepted = '.pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';

function uploadWithProgress(intakeId: string, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData();
    form.set('file', file, file.name);
    const request = new XMLHttpRequest();
    request.open('POST', `/api/intakes/${encodeURIComponent(intakeId)}/sources`);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(JSON.parse(request.responseText || '{}').error || 'Upload failed'));
    request.onerror = () => reject(new Error('The local upload was interrupted'));
    request.send(form);
  });
}

export function ComposeMode({ onReady }: { onReady(projectId: string, intakeId: string): Promise<void> }) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const addFiles = (list: FileList | File[]) => setFiles((current) => [...current, ...Array.from(list).filter((file) => !current.some((item) => item.name === file.name && item.size === file.size))]);
  const drop = (event: DragEvent) => { event.preventDefault(); addFiles(event.dataTransfer.files); };
  const submit = async () => {
    if (!name.trim() || !objective.trim()) { setError('Name the project and describe the finished outcome.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, objective }) });
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || 'Unable to create project');
      for (const file of files) await uploadWithProgress(project.intake_id, file, (value) => setProgress((current) => ({ ...current, [file.name]: value })));
      const analyze = await fetch(`/api/intakes/${project.intake_id}/analyze`, { method: 'POST' });
      const result = await analyze.json();
      if (!analyze.ok) throw new Error(result.error || 'Unable to begin understanding');
      await onReady(project.project_id, project.intake_id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to compose project'); }
    finally { setBusy(false); }
  };
  return <section className="mode-scene compose-scene" aria-labelledby="compose-title">
    <div className="scene-copy"><span className="scene-number">01 / COMPOSE</span><h1 id="compose-title">Describe the outcome.<br /><em>Bring the evidence.</em></h1><p>Tell the Builder what must exist when the work is finished. Add every source that defines the product—text and visuals are understood together.</p></div>
    <div className="compose-surface liquid-surface">
      <label className="field-label">Project name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Restaurant operations suite" autoFocus /></label>
      <label className="field-label outcome-field">Finished outcome<textarea value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Describe the real application, its users, critical flows, constraints, and what success looks like…" rows={7} /></label>
      <div className="drop-field" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
        <input ref={input} type="file" accept={accepted} multiple hidden onChange={(event) => event.target.files && addFiles(event.target.files)} />
        <button type="button" onClick={() => input.current?.click()}><UploadCloud size={22} /><span><strong>Drop documents, drawings, or screenshots</strong><small>PDF, Word, text, PNG, JPEG, and WebP · retained privately with this project</small></span><Paperclip size={16} /></button>
      </div>
      {files.length ? <div className="queued-sources">{files.map((file) => <div key={`${file.name}-${file.size}`}><span className="file-symbol">{file.type.startsWith('image/') ? <FileImage size={15} /> : <FileText size={15} />}</span><span><strong>{file.name}</strong><small>{progress[file.name] !== undefined ? `${progress[file.name]}% transferred locally` : `${Math.ceil(file.size / 1024)} KB · ready`}</small></span><button aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))}><X size={14} /></button></div>)}</div> : null}
      <div className="privacy-line"><LockKeyhole size={14} /><span>Originals stay in the project’s private local intake folder.</span></div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <button className="primary-action" disabled={busy} onClick={() => void submit()}><span>{busy ? 'Preparing understanding…' : 'Understand project'}</span><ArrowRight size={17} /></button>
    </div>
  </section>;
}
