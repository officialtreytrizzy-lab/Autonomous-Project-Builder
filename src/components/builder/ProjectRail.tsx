import { Boxes, Check, CircleDashed, Clock3, Plus, Sparkles } from 'lucide-react';

import type { BuilderProject, UiMode } from './types';

const modes: Array<{ mode: UiMode; summary: string }> = [
  { mode: 'Compose', summary: 'Describe & provide evidence' },
  { mode: 'Understand', summary: 'Review source-grounded brief' },
  { mode: 'Approve & Build', summary: 'Authorize immutable scope' },
  { mode: 'Build', summary: 'Observe execution & launch' },
];

export function ProjectRail({ projects, selectedId, activeMode, onSelect, onNew, onMode }: {
  projects: BuilderProject[];
  selectedId?: string;
  activeMode: UiMode;
  onSelect(project: BuilderProject): void;
  onNew(): void;
  onMode(mode: UiMode): void;
}) {
  return <aside className="project-rail glass-edge" aria-label="Projects and modes">
    <div className="brand-lockup"><span className="brand-mark"><Sparkles size={17} /></span><div><strong>Builder</strong><span>Private autonomy</span></div></div>
    <button className="new-project" onClick={onNew}><Plus size={15} />New project</button>
    <nav className="mode-rail" aria-label="Project workflow">
      {modes.map((item, index) => {
        const active = activeMode === item.mode;
        return <button key={item.mode} className={active ? 'mode-link active' : 'mode-link'} onClick={() => onMode(item.mode)} aria-current={active ? 'step' : undefined}>
          <span className="mode-index">0{index + 1}</span><span><strong>{item.mode}</strong><small>{item.summary}</small></span>{active ? <CircleDashed size={15} /> : null}
        </button>;
      })}
    </nav>
    <div className="rail-divider" />
    <div className="rail-label"><Boxes size={13} />Projects</div>
    <div className="project-list">
      {projects.map((project) => <button key={project.id} className={project.id === selectedId ? 'project-link selected' : 'project-link'} onClick={() => onSelect(project)}>
        <span className={`project-orb state-${project.state}`}>{project.state === 'complete' ? <Check size={11} /> : <Clock3 size={11} />}</span>
        <span><strong>{project.name}</strong><small>Project state · {project.state.replace('-', ' ')}</small></span>
      </button>)}
      {!projects.length ? <p className="rail-empty">Your private projects will appear here.</p> : null}
    </div>
    <p className="local-signature"><span />Local on Computer 2</p>
  </aside>;
}
