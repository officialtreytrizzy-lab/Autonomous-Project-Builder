'use client';

import { ArrowRight, FileImage, FileText, FolderGit2, Globe2, Layers3, LockKeyhole, Monitor, Package, Paperclip, Plus, Smartphone, Tv, UploadCloud, X } from 'lucide-react';
import { DragEvent, useRef, useState } from 'react';

import {
  DELIVERABLE_LABELS, TARGET_CATALOG, defaultTarget, deviceOption, familyOption, isValidBuildTarget, runtimeOption, targetLabel,
  type BuildDeliverable, type BuildDeviceFamily, type BuildRuntime, type BuildTargetFamily, type BuildTargetSelection,
} from '@/lib/target-platform';

const accepted = '.pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';
const planAccepted = '.pdf,.doc,.docx';

declare global { interface Window { builderDesktop?: { selectRepositoryRoot(): Promise<{ path: string; name: string } | null>; selectInputFolder(options?: { title?: string }): Promise<{ path: string; name: string } | null>; selectInputFiles(options?: { title?: string; extensions?: string[] }): Promise<Array<{ path: string; name: string }>>; }; } }

function uploadWithProgress(intakeId: string, file: File, role: 'reference' | 'implementation-plan', onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData(); form.set('file', file, file.name); form.set('role', role);
    const request = new XMLHttpRequest(); request.open('POST', `/api/intakes/${encodeURIComponent(intakeId)}/sources`);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(JSON.parse(request.responseText || '{}').error || 'Upload failed'));
    request.onerror = () => reject(new Error('The local upload was interrupted')); request.send(form);
  });
}

function TargetIcon({ family }: { family: BuildTargetFamily }) {
  if (family === 'tv-streaming') return <Tv size={17} />;
  if (family === 'windows' || family === 'macos') return <Monitor size={17} />;
  if (family === 'web') return <Globe2 size={17} />;
  if (family === 'cross-platform') return <Layers3 size={17} />;
  return <Smartphone size={17} />;
}

export function ComposeMode({ onReady, preferredExisting = false }: { onReady(projectId: string, intakeId: string): Promise<void>; preferredExisting?: boolean }) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [projectKind, setProjectKind] = useState<'new' | 'existing'>(preferredExisting ? 'existing' : 'new');
  const [buildTarget, setBuildTarget] = useState<BuildTargetSelection>(() => defaultTarget());
  const [repositoryRoot, setRepositoryRoot] = useState(''); const [repositoryName, setRepositoryName] = useState('');
  const [implementationPlan, setImplementationPlan] = useState<File | null>(null); const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({}); const [busy, setBusy] = useState(false); const [selectingRepo, setSelectingRepo] = useState(false); const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null); const planInput = useRef<HTMLInputElement>(null); const hasPlan = Boolean(implementationPlan);
  const selectedFamily = familyOption(buildTarget.family)!; const selectedDevice = deviceOption(buildTarget.family, buildTarget.device)!; const selectedRuntime = runtimeOption(buildTarget.family, buildTarget.device, buildTarget.runtime)!;

  const selectFamily = (family: BuildTargetFamily) => { const option = familyOption(family)!; const device = option.devices[0]; const runtime = device.runtimes[0]; setBuildTarget({ family, device: device.id as BuildDeviceFamily, runtime: runtime.id, deliverable: runtime.deliverables[0] }); };
  const selectDevice = (deviceId: BuildDeviceFamily) => { const device = deviceOption(buildTarget.family, deviceId)!; const runtime = device.runtimes[0]; setBuildTarget({ family: buildTarget.family, device: deviceId, runtime: runtime.id, deliverable: runtime.deliverables[0] }); };
  const selectRuntime = (runtimeId: BuildRuntime) => { const runtime = runtimeOption(buildTarget.family, buildTarget.device, runtimeId)!; setBuildTarget((current) => ({ ...current, runtime: runtimeId, deliverable: runtime.deliverables[0] })); };
  const selectDeliverable = (deliverable: BuildDeliverable) => setBuildTarget((current) => ({ ...current, deliverable }));
  const addFiles = (list: FileList | File[]) => setFiles((current) => [...current, ...Array.from(list).filter((file) => !current.some((item) => item.name === file.name && item.size === file.size))]);
  const drop = (event: DragEvent) => { event.preventDefault(); addFiles(event.dataTransfer.files); };
  const chooseRepository = async () => {
    if (!window.builderDesktop?.selectRepositoryRoot) { setError('Folder selection is available in the Windows desktop app.'); return; }
    setSelectingRepo(true); setError('');
    try { const selected = await window.builderDesktop.selectRepositoryRoot(); if (!selected) return; setRepositoryRoot(selected.path); setRepositoryName(selected.name); if (!name.trim()) setName(selected.name); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to select the app folder'); } finally { setSelectingRepo(false); }
  };
  const submit = async () => {
    if (!isValidBuildTarget(buildTarget)) { setError('Choose a valid device, runtime, and final deliverable first.'); return; }
    if (!hasPlan && (!name.trim() || !objective.trim())) { setError('Add a project name and description, or import an implementation plan instead.'); return; }
    if (projectKind === 'existing' && !repositoryRoot) { setError('Choose the existing app or repo folder first.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, objective, buildTarget, repositoryRoot: projectKind === 'existing' ? repositoryRoot : '', inputMode: hasPlan ? 'implementation-plan' : 'manual', implementationPlanFilename: implementationPlan?.name || '' }) });
      const project = await response.json(); if (!response.ok) throw new Error(project.error || 'Unable to create project');
      if (implementationPlan) await uploadWithProgress(project.intake_id, implementationPlan, 'implementation-plan', (value) => setProgress((current) => ({ ...current, [`plan:${implementationPlan.name}`]: value })));
      for (const file of files) await uploadWithProgress(project.intake_id, file, 'reference', (value) => setProgress((current) => ({ ...current, [file.name]: value })));
      const analyze = await fetch(`/api/intakes/${project.intake_id}/analyze`, { method: 'POST' }); const result = await analyze.json(); if (!analyze.ok) throw new Error(result.error || 'Unable to begin understanding');
      await onReady(project.project_id, project.intake_id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to prepare project'); } finally { setBusy(false); }
  };

  return <section className="mode-scene compose-scene" aria-labelledby="compose-title">
    <div className="scene-copy"><span className="scene-number">01 / START</span><h1 id="compose-title">Tell Builder what<br /><em>you want.</em></h1><p>Choose what you are building for first. Builder uses the selected device, runtime, and deliverable to choose the right project structure, toolchain, packaging path, and verification gates.</p></div>
    <div className="compose-surface liquid-surface">
      <div className="project-kind" aria-label="Project starting point">
        <button type="button" className={projectKind === 'new' ? 'active' : ''} onClick={() => { setProjectKind('new'); setError(''); }}><Plus size={17} /><span><strong>New app</strong><small>Start from an idea or plan</small></span></button>
        <button type="button" className={projectKind === 'existing' ? 'active' : ''} onClick={() => { setProjectKind('existing'); setError(''); }}><FolderGit2 size={17} /><span><strong>Existing app</strong><small>Add, fix, or change something</small></span></button>
      </div>

      <section className="target-builder" aria-label="Build target">
        <div className="target-builder-head"><span className="target-builder-icon"><Package size={18} /></span><div><strong>Build for a device first</strong><small>Select platform → device → operating system/runtime → final deliverable.</small></div><span className="target-current">{DELIVERABLE_LABELS[buildTarget.deliverable]}</span></div>
        <div className="target-step"><span className="target-step-label">1 · Platform</span><div className="target-family-grid">{TARGET_CATALOG.map((option) => <button key={option.id} type="button" className={buildTarget.family === option.id ? 'target-choice active' : 'target-choice'} onClick={() => selectFamily(option.id)}><TargetIcon family={option.id} /><span><strong>{option.label}</strong><small>{option.detail}</small></span></button>)}</div></div>
        <div className="target-path-grid">
          <div className="target-step"><span className="target-step-label">2 · Device</span><div className="target-chip-grid">{selectedFamily.devices.map((option) => <button key={option.id} type="button" className={buildTarget.device === option.id ? 'target-chip active' : 'target-chip'} onClick={() => selectDevice(option.id as BuildDeviceFamily)}><strong>{option.label}</strong><small>{option.detail}</small></button>)}</div></div>
          <div className="target-step"><span className="target-step-label">3 · OS / Runtime</span><div className="target-chip-grid">{selectedDevice.runtimes.map((option) => <button key={option.id} type="button" className={buildTarget.runtime === option.id ? 'target-chip active' : 'target-chip'} onClick={() => selectRuntime(option.id)}><strong>{option.label}</strong><small>{option.detail}</small></button>)}</div></div>
          <div className="target-step"><span className="target-step-label">4 · Deliverable</span><div className="target-chip-grid">{selectedRuntime.deliverables.map((deliverable) => <button key={deliverable} type="button" className={buildTarget.deliverable === deliverable ? 'target-chip deliverable active' : 'target-chip deliverable'} onClick={() => selectDeliverable(deliverable)}><strong>{DELIVERABLE_LABELS[deliverable]}</strong><small>Final build output</small></button>)}</div></div>
        </div>
        <div className="target-summary"><span>Selected build contract</span><strong>{targetLabel(buildTarget)}</strong></div>
      </section>

      <section className={hasPlan ? 'implementation-plan-card selected' : 'implementation-plan-card'} aria-label="Implementation plan import">
        <input ref={planInput} type="file" accept={planAccepted} hidden onChange={(event) => setImplementationPlan(event.target.files?.[0] || null)} />
        <span className="implementation-plan-icon"><FileText size={19} /></span><div className="implementation-plan-copy"><span className="implementation-plan-badge">Authoritative build source</span><strong>{implementationPlan ? implementationPlan.name : 'Import an implementation plan'}</strong><small>{implementationPlan ? `${progress[`plan:${implementationPlan.name}`] !== undefined ? `${progress[`plan:${implementationPlan.name}`]}% added · ` : ''}Builder will build from this plan. Supporting files cannot silently override it.` : 'PDF, DOC, or DOCX. When a plan is imported, Project name and description below are optional.'}</small></div>
        <div className="implementation-plan-actions"><button type="button" onClick={() => planInput.current?.click()} disabled={busy}>{implementationPlan ? 'Replace' : 'Choose plan'}</button>{implementationPlan ? <button type="button" onClick={() => { setImplementationPlan(null); if (planInput.current) planInput.current.value = ''; }} disabled={busy}>Remove</button> : null}</div>
      </section>

      <label className="field-label"><span className="field-heading">Project name {hasPlan ? <em>Optional with plan</em> : null}</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={hasPlan ? 'Optional  -  Builder can name it from the plan' : projectKind === 'existing' ? 'My current app' : 'My new app'} autoFocus={!hasPlan} /></label>
      <label className="field-label outcome-field"><span className="field-heading">What should the finished app do? {hasPlan ? <em>Optional with plan</em> : null}</span><textarea value={objective} onChange={(event) => setObjective(event.target.value)} placeholder={hasPlan ? 'Optional  -  the imported implementation plan will define the requested build.' : projectKind === 'existing' ? 'Example: Add a customer dashboard, keep the current login and design, and make sure nothing already working breaks.' : 'Example: Build a restaurant operations app where managers can track inventory, staff tasks, and daily sales.'} rows={7} /></label>
      {projectKind === 'existing' ? <><section className={repositoryRoot ? 'repo-root-field selected' : 'repo-root-field attention'} aria-label="Existing app folder"><span className="repo-root-icon"><FolderGit2 size={18} /></span><div><strong>{repositoryRoot ? repositoryName || 'Selected app folder' : 'Choose the app or repo folder'}</strong><small>{repositoryRoot ? repositoryRoot : 'Builder will inspect this folder first and make your approved changes in place.'}</small></div><div className="repo-root-actions"><button type="button" onClick={() => void chooseRepository()} disabled={busy || selectingRepo}>{selectingRepo ? 'Opening...' : repositoryRoot ? 'Change folder' : 'Choose folder'}</button>{repositoryRoot ? <button type="button" onClick={() => { setRepositoryRoot(''); setRepositoryName(''); }} disabled={busy}>Clear</button> : null}</div></section>{repositoryRoot ? <div className="repo-root-note"><LockKeyhole size={13} /><span>Builder treats this as the current app, preserves working behavior, and changes only what your approved plan requires.</span></div> : null}</> : <div className="new-project-note"><Plus size={14} /><span>Builder creates this app as its own private project folder directly under your Windows user directory.</span></div>}
      <div className="supporting-label"><strong>Supporting screenshots & reference files</strong><span>Optional context</span></div>
      <div className="drop-field" onDragOver={(event) => event.preventDefault()} onDrop={drop}><input ref={input} type="file" accept={accepted} multiple hidden onChange={(event) => event.target.files && addFiles(event.target.files)} /><button type="button" onClick={() => input.current?.click()}><UploadCloud size={22} /><span><strong>Add screenshots, documents, or drawings</strong><small>PDF, Word, text, PNG, JPEG, and WebP. These support the plan or description; they do not silently replace an imported implementation plan.</small></span><Paperclip size={16} /></button></div>
      {files.length ? <div className="queued-sources">{files.map((file) => <div key={`${file.name}-${file.size}`}><span className="file-symbol">{file.type.startsWith('image/') ? <FileImage size={15} /> : <FileText size={15} />}</span><span><strong>{file.name}</strong><small>{progress[file.name] !== undefined ? `${progress[file.name]}% added` : `${Math.ceil(file.size / 1024)} KB · ready`}</small></span><button aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))}><X size={14} /></button></div>)}</div> : null}
      <div className="privacy-line"><LockKeyhole size={14} /><span>Your implementation plan, project, and supporting files stay private on this computer.</span></div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <button className="primary-action" disabled={busy} onClick={() => void submit()}><span>{busy ? 'Reading your project...' : hasPlan ? 'Review imported plan' : 'Review what Builder understood'}</span><ArrowRight size={17} /></button>
    </div>
  </section>;
}
