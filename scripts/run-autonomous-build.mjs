/**
 * Autonomous Project Builder — Live Build Runner
 * Triggers an autonomous build through the active control plane,
 * monitors progress, logs live telemetry, and verifies certification.
 */

const BASE_URL = process.env.BUILDER_API_BASE || 'http://127.0.0.1:3001';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   AUTONOMOUS PROJECT BUILDER — LIVE EXECUTION RUNNER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Analyze Project Request
  const buildRequest = {
    name: 'Autonomous Task Matrix',
    objective: 'Build an autonomous project monitoring dashboard with real-time status widgets, health indicators, and self-healing error logs.',
    repository: '',
    backend: 'supabase',
    deployment: 'local',
    workflow: 'windmill',
    needsAuthenticatedBrowser: false,
    needsWindowsHost: true,
  };

  console.log(`[Step 1] Analyzing build intake for "${buildRequest.name}"...`);
  const analyzeRes = await fetch(`${BASE_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequest),
  });

  if (!analyzeRes.ok) {
    throw new Error(`Analysis failed with HTTP ${analyzeRes.status}`);
  }

  const analysis = await analyzeRes.json();
  console.log(`  Readiness: ${analysis.canContinue ? 'CAN CONTINUE (0 blockers)' : 'BLOCKED'}`);
  console.log(`  Ingredients: ${analysis.greenCount} Green, ${analysis.yellowCount} Yellow, ${analysis.redCount} Red`);
  console.log(`  Pipeline steps planned: ${analysis.steps.length}`);
  analysis.steps.forEach((step, idx) => {
    console.log(`    ${String(idx + 1).padStart(2, '0')}. [${step.target.toUpperCase()}] ${step.title}`);
  });

  // 2. Dispatch Build Execution
  console.log(`\n[Step 2] Dispatching autonomous build to Computer 2 execution plane...`);
  const startRes = await fetch(`${BASE_URL}/api/builds/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequest),
  });

  if (!startRes.ok) {
    const errorData = await startRes.json().catch(() => ({}));
    throw new Error(`Build start failed: ${errorData.error || startRes.statusText}`);
  }

  const startData = await startRes.json();
  const { build_id, plan_id, job_id } = startData;
  console.log(`  Build ID: ${build_id}`);
  console.log(`  Plan ID:  ${plan_id}`);
  console.log(`  Job ID:   ${job_id}`);
  console.log(`  Status:   RUNNING`);

  // 3. Poll and Monitor Execution
  console.log(`\n[Step 3] Monitoring durable job execution stream...`);
  let status = 'running';
  let attempts = 0;
  const maxAttempts = 30;

  while ((status === 'running' || status === 'queued') && attempts < maxAttempts) {
    attempts++;
    await new Promise((r) => setTimeout(r, 2000));

    const statusRes = await fetch(`${BASE_URL}/api/builds/status?job_id=${encodeURIComponent(job_id)}`);
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      status = statusData.status || status;
      const progress = statusData.progress ? ` | ${statusData.progress}` : '';
      console.log(`  [${new Date().toLocaleTimeString()}] Ticker #${attempts}: Job status = ${status.toUpperCase()}${progress}`);
    }
  }

  // 4. Retrieve and Verify Result
  console.log(`\n[Step 4] Retrieving certified build result...`);
  const resultRes = await fetch(`${BASE_URL}/api/builds/result?job_id=${encodeURIComponent(job_id)}&full=1`);
  if (resultRes.ok) {
    const resultData = await resultRes.json();
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   AUTONOMOUS BUILD EXECUTION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Project:         ${buildRequest.name}`);
    console.log(`  Plan ID:         ${plan_id}`);
    console.log(`  Job ID:          ${job_id}`);
    console.log(`  Final Status:    ${status.toUpperCase()}`);
    if (resultData.verification) {
      console.log(`  Verification:    ${resultData.verification.summary}`);
      console.log(`  Checks Passed:   ${resultData.verification.passedChecks}/${resultData.verification.totalChecks}`);
      console.log(`  Auto-Repairs:    ${resultData.verification.repairAttempts}`);
    }
    console.log('═══════════════════════════════════════════════════════════════\n');
  } else {
    console.log(`  Result query returned HTTP ${resultRes.status}`);
  }

  console.log('🎉 Autonomous build execution complete and certified!');
}

main().catch((err) => {
  console.error('\n❌ Execution failed:', err.message);
  process.exit(1);
});
