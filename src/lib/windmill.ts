/**
 * Windmill API client for durable workflow orchestration.
 * Dispatches long-running operations to the self-hosted Windmill instance on :80.
 */

const WINDMILL_BASE = process.env.WINDMILL_URL?.replace(/\/$/, '') || 'http://127.0.0.1';
const WINDMILL_TOKEN = process.env.WINDMILL_TOKEN || '';
const WINDMILL_WORKSPACE = process.env.WINDMILL_WORKSPACE || 'admins';

export type WindmillJobStatus = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: unknown;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

function windmillHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WINDMILL_TOKEN) headers['Authorization'] = `Bearer ${WINDMILL_TOKEN}`;
  return headers;
}

/**
 * Check if Windmill is reachable and get version info.
 */
export async function windmillHealth(): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const res = await fetch(`${WINDMILL_BASE}/api/version`, {
      headers: windmillHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const version = await res.text();
      return { ok: true, version };
    }
    // Fallback — try root for basic HTTP check
    const rootRes = await fetch(WINDMILL_BASE, { signal: AbortSignal.timeout(3000) });
    return { ok: rootRes.ok, version: 'unknown' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run a Windmill script by path. Returns the job ID for tracking.
 */
export async function runWindmillScript(
  scriptPath: string,
  args: Record<string, unknown> = {},
): Promise<{ jobId: string; ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${WINDMILL_BASE}/api/w/${WINDMILL_WORKSPACE}/jobs/run/p/${scriptPath}`, {
      method: 'POST',
      headers: windmillHeaders(),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { jobId: '', ok: false, error: `Windmill returned HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const jobId = await res.text();
    return { jobId: jobId.replace(/"/g, ''), ok: true };
  } catch (e) {
    return { jobId: '', ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run a Windmill flow by path. Returns the job ID for tracking.
 */
export async function runWindmillFlow(
  flowPath: string,
  args: Record<string, unknown> = {},
): Promise<{ jobId: string; ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${WINDMILL_BASE}/api/w/${WINDMILL_WORKSPACE}/jobs/run/f/${flowPath}`, {
      method: 'POST',
      headers: windmillHeaders(),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { jobId: '', ok: false, error: `Windmill returned HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const jobId = await res.text();
    return { jobId: jobId.replace(/"/g, ''), ok: true };
  } catch (e) {
    return { jobId: '', ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Get status of a Windmill job.
 */
export async function getWindmillJobStatus(jobId: string): Promise<WindmillJobStatus> {
  try {
    const res = await fetch(`${WINDMILL_BASE}/api/w/${WINDMILL_WORKSPACE}/jobs_u/get/${jobId}`, {
      headers: windmillHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { id: jobId, status: 'failed', error: `HTTP ${res.status}` };
    }
    const data = await res.json() as Record<string, unknown>;
    const rawType = String(data.type || '');
    let status: WindmillJobStatus['status'] = 'queued';
    if (rawType === 'CompletedJob') status = data.success ? 'completed' : 'failed';
    else if (data.running) status = 'running';
    else if (data.canceled) status = 'cancelled';

    return {
      id: jobId,
      status,
      result: data.result,
      startedAt: typeof data.started_at === 'string' ? data.started_at : undefined,
      completedAt: typeof data.completed_at === 'string' ? data.completed_at : undefined,
      error: status === 'failed' ? String(data.result || '') : undefined,
    };
  } catch (e) {
    return { id: jobId, status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Cancel a Windmill job.
 */
export async function cancelWindmillJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${WINDMILL_BASE}/api/w/${WINDMILL_WORKSPACE}/jobs_u/queue/cancel/${jobId}`, {
      method: 'POST',
      headers: windmillHeaders(),
      body: JSON.stringify({ reason: 'Cancelled by Autonomous Project Builder' }),
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * List completed and running jobs in the workspace.
 */
export async function listWindmillJobs(limit = 10): Promise<{ jobs: WindmillJobStatus[]; ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${WINDMILL_BASE}/api/w/${WINDMILL_WORKSPACE}/jobs/list?per_page=${limit}`, {
      headers: windmillHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { jobs: [], ok: false, error: `HTTP ${res.status}` };
    const data = await res.json() as Array<Record<string, unknown>>;
    const jobs: WindmillJobStatus[] = data.map((j) => ({
      id: String(j.id || ''),
      status: j.type === 'CompletedJob' ? (j.success ? 'completed' : 'failed') : (j.running ? 'running' : 'queued'),
      startedAt: typeof j.started_at === 'string' ? j.started_at : undefined,
      completedAt: typeof j.completed_at === 'string' ? j.completed_at : undefined,
    }));
    return { jobs, ok: true };
  } catch (e) {
    return { jobs: [], ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
