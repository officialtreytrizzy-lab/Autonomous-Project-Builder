'use client';

import { ChevronDown, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

type HealthPayload = {
  status?: string;
  degradedCapabilities?: string[];
  unavailableCore?: string[];
  services?: Record<string, { ok: boolean; detail?: string; error?: string }>;
};

export function SystemHealth() {
  const [health, setHealth] = useState<HealthPayload>({ status: 'checking' });
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        const payload = await response.json() as HealthPayload;
        if (!disposed) setHealth(payload);
      } catch {
        if (!disposed) setHealth({ status: 'unavailable', unavailableCore: ['localRuntime'] });
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  const degraded = (health.degradedCapabilities?.length || 0) > 0;
  const healthy = health.status === 'ready' && !degraded;
  const label = healthy ? 'Everything ready' : health.status === 'checking' ? 'Getting ready' : degraded ? 'Some tools need attention' : 'Builder needs attention';
  return <div className={`system-health ${healthy ? 'healthy' : degraded ? 'degraded' : 'unavailable'}`}>
    <button onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls="system-health-details">
      <span className="health-light" /><ShieldCheck size={15} /><span>{label}</span><ChevronDown size={14} />
    </button>
    {expanded ? <div id="system-health-details" className="health-details">
      {Object.entries(health.services || {}).map(([name, service]) => <div key={name}><span className={service.ok ? 'live-green' : 'live-yellow'} /><strong>{name}</strong><small>{service.ok ? service.detail || 'Available' : service.error || service.detail || 'Unavailable for tasks that require it'}</small></div>)}
    </div> : null}
  </div>;
}
