'use client';

import { CheckCircle2, Files, FolderOpen, HardDrive, KeyRound, Link2, LockKeyhole, PlugZap, ShieldCheck, TriangleAlert } from 'lucide-react';
import { FormEvent, useState } from 'react';

import type { BuildRequirementState } from '@/lib/intake/types';

function extensionsLabel(values?: string[]) {
  return (values || []).map((value) => value.replace(/^\./, '').toUpperCase()).join(', ');
}

function RequirementIcon({ kind }: { kind: BuildRequirementState['requirement']['kind'] }) {
  if (kind === 'folder') return <FolderOpen size={17} />;
  if (kind === 'files') return <Files size={17} />;
  if (kind === 'credential') return <KeyRound size={17} />;
  if (kind === 'url') return <Link2 size={17} />;
  if (kind === 'device') return <HardDrive size={17} />;
  return <PlugZap size={17} />;
}

export function RequirementsPanel({ intakeId, requirements, onChanged }: { intakeId: string; requirements: BuildRequirementState[]; onChanged(): Promise<void> }) {
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [credentialValues, setCredentialValues] = useState<Record<string, Record<string, string>>>({});

  const save = async (requirementId: string, payload: unknown) => {
    setBusy(requirementId); setErrors((current) => ({ ...current, [requirementId]: '' }));
    try {
      const response = await fetch(`/api/intakes/${encodeURIComponent(intakeId)}/requirements/${encodeURIComponent(requirementId)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save this required input');
      setCredentialValues((current) => ({ ...current, [requirementId]: {} }));
      await onChanged();
    } catch (cause) {
      setErrors((current) => ({ ...current, [requirementId]: cause instanceof Error ? cause.message : 'Unable to save this required input' }));
    } finally { setBusy(''); }
  };

  const chooseFolder = async (state: BuildRequirementState) => {
    const picker = window.builderDesktop?.selectInputFolder;
    if (!picker) { setErrors((current) => ({ ...current, [state.requirement.id]: 'Folder selection is available in the installed Windows desktop app.' })); return; }
    const selected = await picker({ title: `Choose ${state.requirement.label}` });
    if (selected) await save(state.requirement.id, { mode: 'paths', paths: [selected.path] });
  };

  const chooseFiles = async (state: BuildRequirementState) => {
    const picker = window.builderDesktop?.selectInputFiles;
    if (!picker) { setErrors((current) => ({ ...current, [state.requirement.id]: 'File selection is available in the installed Windows desktop app.' })); return; }
    const selected = await picker({ title: `Choose ${state.requirement.label}`, extensions: state.requirement.acceptedExtensions || [] });
    if (selected?.length) await save(state.requirement.id, { mode: 'paths', paths: selected.map((item) => item.path) });
  };

  const credentialSubmit = (event: FormEvent<HTMLFormElement>, state: BuildRequirementState) => {
    event.preventDefault();
    void save(state.requirement.id, { mode: 'credential', fields: credentialValues[state.requirement.id] || {} });
  };

  const requiredMissing = requirements.filter((state) => state.requirement.required && !state.satisfied).length;
  return <section className="requirements-panel" aria-label="Required build inputs">
    <div className="section-heading requirements-heading"><div><span>Build inputs & access</span><h2>{requirements.length ? requiredMissing ? `Builder still needs ${requiredMissing}` : 'Everything required is ready' : 'Builder has what it needs'}</h2></div>{requiredMissing ? <TriangleAlert size={18} /> : <ShieldCheck size={18} />}</div>
    <p className="requirements-intro">Builder checked the plan for anything only you can provide. Required items must be ready before the build can move forward.</p>
    {!requirements.length ? <div className="requirements-complete"><CheckCircle2 size={16} /><span>No additional files, accounts, credentials, devices, or manual inputs are required from you.</span></div> : <div className="requirement-list">{requirements.map((state) => {
      const requirement = state.requirement;
      const meta = [requirement.minCount ? `Minimum ${requirement.minCount}` : '', extensionsLabel(requirement.acceptedExtensions), requirement.provider || ''].filter(Boolean);
      return <article key={requirement.id} className={state.satisfied ? 'requirement-card satisfied' : 'requirement-card missing'}>
        <div className="requirement-top"><span className="requirement-icon"><RequirementIcon kind={requirement.kind} /></span><div><div className="requirement-title"><strong>{requirement.label}</strong><em>{requirement.required ? 'Required' : 'Optional'}</em></div><p>{requirement.description}</p>{meta.length ? <small>{meta.join(' · ')}</small> : null}</div><span className={state.satisfied ? 'requirement-status ready' : 'requirement-status needed'}>{state.satisfied ? <><CheckCircle2 size={12} />Ready</> : 'Needed'}</span></div>
        <div className="requirement-why"><strong>Why Builder needs it</strong><span>{requirement.reason}</span></div>
        {state.satisfied ? <div className="requirement-satisfied"><CheckCircle2 size={14} /><span>{state.summary}</span>{state.source === 'saved' ? <em><LockKeyhole size={11} />Reusable encrypted access</em> : null}</div> : null}

        {requirement.kind === 'folder' ? <button type="button" className="requirement-action" disabled={busy === requirement.id} onClick={() => void chooseFolder(state)}><FolderOpen size={14} />{busy === requirement.id ? 'Checking folder...' : state.satisfied ? 'Replace folder' : 'Choose folder'}</button> : null}
        {requirement.kind === 'files' ? <button type="button" className="requirement-action" disabled={busy === requirement.id} onClick={() => void chooseFiles(state)}><Files size={14} />{busy === requirement.id ? 'Adding files...' : state.satisfied ? 'Replace files' : 'Choose files'}</button> : null}

        {requirement.kind === 'credential' ? <form className="credential-form" onSubmit={(event) => credentialSubmit(event, state)}>
          {state.source === 'saved' ? <div className="credential-safe-note"><LockKeyhole size={12} />The saved value is never shown again. Enter a new value only if you want to replace the current access.</div> : state.satisfied ? <div className="credential-safe-note"><LockKeyhole size={12} />Existing access is already available. Enter a value only if you want Builder to save an encrypted override for future projects.</div> : null}
          {(requirement.fields || []).map((field) => <label key={field.id}><span>{field.label}{field.envVar ? <em>{field.envVar}</em> : null}</span><input type={field.type === 'secret' ? 'password' : 'text'} autoComplete="off" value={credentialValues[requirement.id]?.[field.id] || ''} onChange={(event) => setCredentialValues((current) => ({ ...current, [requirement.id]: { ...(current[requirement.id] || {}), [field.id]: event.target.value } }))} placeholder={field.placeholder || (field.type === 'secret' ? 'Enter securely' : 'Enter value')} required={!state.satisfied && field.required !== false} /></label>)}
          <button type="submit" className="requirement-action" disabled={busy === requirement.id || !Object.values(credentialValues[requirement.id] || {}).some(Boolean)}><KeyRound size={14} />{busy === requirement.id ? 'Encrypting & saving...' : state.satisfied ? 'Replace saved access' : 'Save encrypted access'}</button>
          <div className="credential-persistence"><ShieldCheck size={12} />Saved for future Builder projects on this Windows account. Secret values never enter the project plan or chat.</div>
        </form> : null}

        {(requirement.kind === 'text' || requirement.kind === 'url') ? <form className="requirement-value-form" onSubmit={(event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get('value') || ''); void save(requirement.id, { mode: 'value', value }); }}><input name="value" type={requirement.kind === 'url' ? 'url' : 'text'} required placeholder={requirement.examples?.[0] || (requirement.kind === 'url' ? 'https://...' : 'Enter the required information')} /><button className="requirement-action" disabled={busy === requirement.id}>{busy === requirement.id ? 'Saving...' : state.satisfied ? 'Update' : 'Save'}</button></form> : null}

        {(requirement.kind === 'manual' || requirement.kind === 'device') ? <form className="requirement-value-form" onSubmit={(event) => { event.preventDefault(); const note = String(new FormData(event.currentTarget).get('note') || ''); void save(requirement.id, { mode: 'confirm', note }); }}><input name="note" type="text" placeholder="Optional note about what is ready" /><button className="requirement-action" disabled={busy === requirement.id}>{busy === requirement.id ? 'Saving...' : state.satisfied ? 'Confirm again' : 'Confirm ready'}</button></form> : null}
        {errors[requirement.id] ? <p className="inline-error requirement-error" role="alert">{errors[requirement.id]}</p> : null}
      </article>;
    })}</div>}
  </section>;
}
