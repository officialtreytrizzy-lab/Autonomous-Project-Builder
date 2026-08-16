import { BadgeCheck, Boxes, Check, CircleDashed, Clock3, FilePenLine, Hammer, Palette, Plus, SearchCheck, Sparkles, type LucideIcon } from 'lucide-react';

import type { BuilderProject, UiMode } from './types';

const modes: Array<{ mode: UiMode; summary: string; icon: LucideIcon }> = [
  { mode: 'Compose', summary: 'Tell Builder what you want', icon: FilePenLine },
  { mode: 'Understand', summary: 'Check what Builder understood', icon: SearchCheck },
  { mode: 'Design', summary: 'Shape the app with the design director', icon: Palette },
  { mode: 'Approve & Build', summary: 'Confirm before work starts', icon: BadgeCheck },
  { mode: 'Build', summary: 'Watch progress & open the result', icon: Hammer },
];

export function ProjectRail({ projects, selectedId, activeMode, onSelect, onNew, onMode }: {
  projects: BuilderProject[];
  selectedId?: string;
  activeMode: UiMode;
  onSelect(project: BuilderProject): void;
  onNew(): void;
  onMode(mode: UiMode): void;
}) {
  return <aside className="project-rail glass-edge" aria-label="Projects and steps">
    <div className="brand-lockup"><span className="brand-mark"><Sparkles size={17} /></span><div><strong>Autonomous Builder</strong><span>Build apps locally</span></div></div>
    <button className="new-project" aria-label="New project" onClick={onNew}><Plus size={15} />Start a project</button>
    <nav className="mode-rail" aria-label="Project steps">
      {modes.map((item, index) => {
        const active = activeMode === item.mode;
        const Icon = item.icon;
        return <button key={item.mode} title={item.mode} className={active ? 'mode-link active' : 'mode-link'} onClick={() => onMode(item.mode)} aria-current={active ? 'step' : undefined}>
          <span className="mode-glyph"><Icon size={16} /></span><span className="mode-copy"><strong>{item.mode}</strong><small>{item.summary}</small></span><span className="mode-trailing">{active ? <CircleDashed size={14} /> : <span className="mode-index">0{index + 1}</span>}</span>
        </button>;
      })}
    </nav>
    <div className="rail-divider" />
    <div className="rail-label"><Boxes size={13} />Your projects</div>
    <div className="project-list">
      {projects.map((project) => <button key={project.id} className={project.id === selectedId ? 'project-link selected' : 'project-link'} onClick={() => onSelect(project)}>
        <span className={`project-orb state-${project.state}`}>{project.state === 'complete' ? <Check size={11} /> : <Clock3 size={11} />}</span>
        <span><strong>{project.name}</strong><small>Status · {project.state.replace('-', ' ')}</small></span>
      </button>)}
      {!projects.length ? <p className="rail-empty">No projects yet. Start one above and Builder will keep it here for you.</p> : null}
    </div>
    <p className="local-signature"><span />Private on this computer</p>
  </aside>;
}
