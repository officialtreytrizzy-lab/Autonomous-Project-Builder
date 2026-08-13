const activelyExecuting = new Set(['planning', 'queued', 'running', 'paused', 'repairing']);

export function selectBuildForRestore<T extends { status: string; jobId?: string }>(builds: T[]) {
  return builds.find((build) => activelyExecuting.has(build.status))
    || builds.find((build) => build.status === 'interrupted' && Boolean(build.jobId))
    || builds.find((build) => build.status !== 'interrupted')
    || builds[0];
}
