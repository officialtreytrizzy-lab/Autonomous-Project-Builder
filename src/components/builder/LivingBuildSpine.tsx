import { Check, CircleDashed, GitBranch, ShieldAlert } from 'lucide-react';

import type { SpineNode } from '@/lib/intake/events';

export function LivingBuildSpine({ nodes }: { nodes: SpineNode[] }) {
  const complete = nodes.filter((node) => node.status === 'complete').length;
  return <section className="spine-shell" aria-label="Living Build Spine">
    <header><div><span>Living Build Spine</span><h2>Persisted execution</h2></div><strong>{complete} / {nodes.length || '—'} stages complete</strong></header>
    <div className="living-spine">{nodes.length ? nodes.map((node) => <article key={node.stage} className={`spine-node spine-${node.status}`}>
      <div className="spine-track"><span className="spine-segment" /><span className="spine-core">{node.status === 'complete' ? <Check size={13} /> : node.status === 'blocked' ? <ShieldAlert size={13} /> : <CircleDashed size={13} />}</span></div>
      <div className="spine-content"><div><strong>{node.stage.replaceAll('-', ' ')}</strong><small>Events {node.firstSequence}–{node.lastSequence}</small></div><p>{node.messages.at(-1)}</p>
        {node.repairBranches.map((repair) => <div className={`spine-repair ${repair.reconnected ? 'spine-recovered' : 'spine-blocked'}`} key={repair.eventId}><GitBranch size={14} /><span><strong>{repair.reconnected ? 'Recovered' : 'Repairing'}</strong><small>{repair.message}</small></span><i /></div>)}
      </div>
    </article>) : <div className="spine-empty"><CircleDashed /><p>Waiting for the first persisted execution event.</p></div>}</div>
    <span className="spine-repair spine-blocked spine-recovered spine-complete" hidden />
  </section>;
}
