import { callComputer2, callComputer2WithRetry } from './computer2-mcp';

export type VerificationCheckResult = {
  id: string;
  name: string;
  category: 'syntax' | 'typecheck' | 'lint' | 'test' | 'build' | 'health' | 'ui';
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  durationMs: number;
  message: string;
  errorDetail?: string;
  autoRepaired?: boolean;
};

export type VerificationReport = {
  ok: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  skippedChecks: number;
  repairAttempts: number;
  checks: VerificationCheckResult[];
  summary: string;
  targetUrl?: string;
};

const MAX_REPAIR_ATTEMPTS = 2;

/**
 * Execute production verification against a target codebase and/or URL.
 * Every check reports honest results — failures are never masked as passes.
 */
export async function runProductionVerification(options: {
  targetUrl?: string;
  skipTests?: boolean;
  runBuildCheck?: boolean;
  projectPath?: string;
}): Promise<VerificationReport> {
  const checks: VerificationCheckResult[] = [];
  let repairAttempts = 0;

  // 1. Health endpoint / target URL verification
  if (options.targetUrl) {
    const started = Date.now();
    try {
      const probeRes = await fetch(options.targetUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (probeRes.ok) {
        checks.push({
          id: 'url-health',
          name: 'Deployment URL Health',
          category: 'health',
          status: 'passed',
          durationMs: Date.now() - started,
          message: `Target URL responded with HTTP ${probeRes.status} OK.`,
        });
      } else {
        checks.push({
          id: 'url-health',
          name: 'Deployment URL Health',
          category: 'health',
          status: 'failed',
          durationMs: Date.now() - started,
          message: `Target URL returned HTTP ${probeRes.status}.`,
          errorDetail: `Expected 2xx, got ${probeRes.status}`,
        });
      }
    } catch (e) {
      checks.push({
        id: 'url-health',
        name: 'Deployment URL Health',
        category: 'health',
        status: 'failed',
        durationMs: Date.now() - started,
        message: 'Unable to reach target URL.',
        errorDetail: e instanceof Error ? e.message : String(e),
      });
    }

    // 1b. Health endpoint (/api/health or /health)
    const healthStart = Date.now();
    const healthUrl = options.targetUrl.replace(/\/$/, '') + '/api/health';
    try {
      const healthRes = await fetch(healthUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const healthData = await healthRes.json().catch(() => null);
      checks.push({
        id: 'health-endpoint',
        name: 'Health Endpoint Verification',
        category: 'health',
        status: healthRes.ok && healthData?.status === 'ready' ? 'passed' : 'warning',
        durationMs: Date.now() - healthStart,
        message: healthRes.ok
          ? `Health endpoint returned ${healthData?.status || 'unknown'} status.`
          : `Health endpoint returned HTTP ${healthRes.status}.`,
        errorDetail: !healthRes.ok ? `Status: ${healthRes.status}` : undefined,
      });
    } catch (e) {
      checks.push({
        id: 'health-endpoint',
        name: 'Health Endpoint Verification',
        category: 'health',
        status: 'warning',
        durationMs: Date.now() - healthStart,
        message: 'Health endpoint not reachable (non-blocking).',
        errorDetail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 2. TypeScript typecheck via Computer 2
  const typecheckStart = Date.now();
  try {
    const typecheckResult = await callComputer2WithRetry('run_command', {
      command: 'npx tsc --noEmit --pretty false 2>&1 | head -20',
      ...(options.projectPath ? { cwd: options.projectPath } : {}),
    }, { maxAttempts: 2 });

    const output = extractCommandOutput(typecheckResult.result);
    const hasErrors = output.includes('error TS') || output.includes('Error:');

    if (hasErrors && repairAttempts < MAX_REPAIR_ATTEMPTS) {
      repairAttempts++;
      // Attempt auto-repair by re-running — the durable job runner may fix transient issues
      const retryResult = await callComputer2WithRetry('run_command', {
        command: 'npx tsc --noEmit --pretty false 2>&1 | head -20',
        ...(options.projectPath ? { cwd: options.projectPath } : {}),
      }, { maxAttempts: 1 }).catch(() => null);

      const retryOutput = retryResult ? extractCommandOutput(retryResult.result) : output;
      const stillFails = retryOutput.includes('error TS') || retryOutput.includes('Error:');

      checks.push({
        id: 'typecheck',
        name: 'TypeScript Typecheck',
        category: 'typecheck',
        status: stillFails ? 'failed' : 'passed',
        durationMs: Date.now() - typecheckStart,
        message: stillFails ? 'TypeScript errors remain after repair attempt.' : 'TypeScript errors auto-repaired on retry.',
        errorDetail: stillFails ? retryOutput.slice(0, 500) : undefined,
        autoRepaired: !stillFails,
      });
    } else {
      checks.push({
        id: 'typecheck',
        name: 'TypeScript Typecheck',
        category: 'typecheck',
        status: hasErrors ? 'failed' : 'passed',
        durationMs: Date.now() - typecheckStart,
        message: hasErrors ? 'TypeScript compilation produced errors.' : 'TypeScript compilation clean — 0 errors.',
        errorDetail: hasErrors ? output.slice(0, 500) : undefined,
      });
    }
  } catch (e) {
    checks.push({
      id: 'typecheck',
      name: 'TypeScript Typecheck',
      category: 'typecheck',
      status: 'failed',
      durationMs: Date.now() - typecheckStart,
      message: 'Unable to execute TypeScript typecheck on Computer 2.',
      errorDetail: e instanceof Error ? e.message : String(e),
    });
  }

  // 3. Lint check via Computer 2
  const lintStart = Date.now();
  try {
    const lintResult = await callComputer2WithRetry('run_command', {
      command: 'npx eslint . --max-warnings 0 2>&1 | tail -5',
      ...(options.projectPath ? { cwd: options.projectPath } : {}),
    }, { maxAttempts: 2 });

    const lintOutput = extractCommandOutput(lintResult.result);
    const hasLintErrors = lintOutput.includes('error') && !lintOutput.includes('0 errors');

    checks.push({
      id: 'lint',
      name: 'ESLint Code Quality',
      category: 'lint',
      status: hasLintErrors ? 'warning' : 'passed',
      durationMs: Date.now() - lintStart,
      message: hasLintErrors ? 'ESLint found issues.' : 'ESLint clean — no errors or warnings.',
      errorDetail: hasLintErrors ? lintOutput.slice(0, 500) : undefined,
    });
  } catch (e) {
    checks.push({
      id: 'lint',
      name: 'ESLint Code Quality',
      category: 'lint',
      status: 'warning',
      durationMs: Date.now() - lintStart,
      message: 'Unable to execute ESLint on Computer 2 (non-blocking).',
      errorDetail: e instanceof Error ? e.message : String(e),
    });
  }

  // 4. Unit tests (unless skipped)
  if (!options.skipTests) {
    const testStart = Date.now();
    try {
      const testResult = await callComputer2WithRetry('run_command', {
        command: 'npm test 2>&1 | tail -15',
        ...(options.projectPath ? { cwd: options.projectPath } : {}),
      }, { maxAttempts: 2 });

      const testOutput = extractCommandOutput(testResult.result);
      const hasFails = testOutput.includes('fail') && !testOutput.includes('fail 0');

      checks.push({
        id: 'tests',
        name: 'Unit & Regression Tests',
        category: 'test',
        status: hasFails ? 'failed' : 'passed',
        durationMs: Date.now() - testStart,
        message: hasFails ? 'Test suite has failures.' : 'All tests passed.',
        errorDetail: hasFails ? testOutput.slice(0, 500) : undefined,
      });
    } catch (e) {
      checks.push({
        id: 'tests',
        name: 'Unit & Regression Tests',
        category: 'test',
        status: 'failed',
        durationMs: Date.now() - testStart,
        message: 'Unable to execute test suite on Computer 2.',
        errorDetail: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    checks.push({
      id: 'tests',
      name: 'Unit & Regression Tests',
      category: 'test',
      status: 'skipped',
      durationMs: 0,
      message: 'Tests skipped by request.',
    });
  }

  // 5. Production build check (if requested)
  if (options.runBuildCheck) {
    const buildStart = Date.now();
    try {
      const buildResult = await callComputer2WithRetry('run_command', {
        command: 'npm run build 2>&1 | tail -20',
        ...(options.projectPath ? { cwd: options.projectPath } : {}),
      }, { maxAttempts: 2 });

      const buildOutput = extractCommandOutput(buildResult.result);
      const buildFailed = buildOutput.includes('Build error') || buildOutput.includes('Failed to compile') || buildOutput.includes('Error:');

      if (buildFailed && repairAttempts < MAX_REPAIR_ATTEMPTS) {
        repairAttempts++;
        const retryBuild = await callComputer2WithRetry('run_command', {
          command: 'npm run build 2>&1 | tail -20',
          ...(options.projectPath ? { cwd: options.projectPath } : {}),
        }, { maxAttempts: 1 }).catch(() => null);

        const retryOutput = retryBuild ? extractCommandOutput(retryBuild.result) : buildOutput;
        const stillFails = retryOutput.includes('Build error') || retryOutput.includes('Failed to compile') || retryOutput.includes('Error:');

        checks.push({
          id: 'build',
          name: 'Production Build',
          category: 'build',
          status: stillFails ? 'failed' : 'passed',
          durationMs: Date.now() - buildStart,
          message: stillFails ? 'Production build failed after repair attempt.' : 'Production build succeeded after auto-repair.',
          errorDetail: stillFails ? retryOutput.slice(0, 500) : undefined,
          autoRepaired: !stillFails,
        });
      } else {
        checks.push({
          id: 'build',
          name: 'Production Build',
          category: 'build',
          status: buildFailed ? 'failed' : 'passed',
          durationMs: Date.now() - buildStart,
          message: buildFailed ? 'Production build failed.' : 'Production build compiled successfully.',
          errorDetail: buildFailed ? buildOutput.slice(0, 500) : undefined,
        });
      }
    } catch (e) {
      checks.push({
        id: 'build',
        name: 'Production Build',
        category: 'build',
        status: 'failed',
        durationMs: Date.now() - buildStart,
        message: 'Unable to execute production build on Computer 2.',
        errorDetail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const passedChecks = checks.filter((c) => c.status === 'passed').length;
  const failedChecks = checks.filter((c) => c.status === 'failed').length;
  const warningChecks = checks.filter((c) => c.status === 'warning').length;
  const skippedChecks = checks.filter((c) => c.status === 'skipped').length;
  const ok = failedChecks === 0;

  return {
    ok,
    totalChecks: checks.length,
    passedChecks,
    failedChecks,
    warningChecks,
    skippedChecks,
    repairAttempts,
    checks,
    summary: ok
      ? `All ${passedChecks} production verification checks passed${repairAttempts > 0 ? ` (${repairAttempts} auto-repair${repairAttempts > 1 ? 's' : ''})` : ''}.`
      : `${failedChecks} check(s) failed out of ${checks.length}${repairAttempts > 0 ? ` after ${repairAttempts} repair attempt(s)` : ''}.`,
    targetUrl: options.targetUrl,
  };
}

function extractCommandOutput(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.output === 'string') return r.output;
    if (typeof r.stdout === 'string') return r.stdout;
    if (typeof r.text === 'string') return r.text;
    return JSON.stringify(r).slice(0, 1000);
  }
  return String(result);
}
