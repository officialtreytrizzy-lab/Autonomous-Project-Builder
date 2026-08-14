import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BuildRequest, ExecutionStep } from './builder';
import type { VerificationCheck } from './build-store';
import type { ApprovalBuildConfiguration, BriefDecision, BuildBrief, SourceManifestItem } from './intake/types';

export type ErrorClass =
  | 'transient/network'
  | 'authentication'
  | 'rate limit'
  | 'dependency unavailable'
  | 'configuration'
  | 'validation'
  | 'code/build error'
  | 'test failure'
  | 'browser bridge'
  | 'service outage'
  | 'user-required input'
  | 'irreversible decision'
  | 'unknown';

export type CompletionEvidence = {
  status?: string;
  appUrl?: string;
  verification?: VerificationCheck[];
  repairs?: Array<Record<string, unknown>>;
  result?: unknown;
};

const REQUIRED_GATES = [
  'dependencies',
  'lint',
  'typecheck',
  'unit-tests',
  'integration-tests',
  'production-build',
  'critical-flows',
  'runtime',
  'http',
  'placeholder-audit',
];

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'local-project';
}

export function classifyBuildError(error: unknown): ErrorClass {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (/irreversible|billing plan|legal approval|high-impact decision/.test(message)) return 'irreversible decision';
  if (/provided by (?:the )?user|user input|required credential|user-only|must provide/.test(message)) return 'user-required input';
  if (/chrome|browser bridge|extension relay|ensurebridge/.test(message)) return 'browser bridge';
  if (/429|rate.?limit|too many requests|quota|usage limit|message cap|hit your usage/.test(message)) return 'rate limit';
  if (/401|403|unauthori[sz]ed|forbidden|authentication|invalid credential|expired credential/.test(message)) return 'authentication';
  if (/econn|timeout|timed out|network|socket|connection reset|dns|fetch failed|streamable http|method not allowed/.test(message)) return 'transient/network';
  if (/docker daemon|dependency unavailable|missing dependency|executable not found|command not found/.test(message)) return 'dependency unavailable';
  if (/service outage|provider outage|service unavailable|maintenance/.test(message)) return 'service outage';
  if (/environment|configuration|not configured|missing config|invalid config/.test(message)) return 'configuration';
  if (/zod|validation|invalid request|schema/.test(message)) return 'validation';
  if (/test failed|tests failed|assertion|vitest|jest|playwright/.test(message)) return 'test failure';
  if (/typescript|typecheck|compile|build error|syntaxerror|ts\d{4}/.test(message)) return 'code/build error';
  return 'unknown';
}

export function validateCompletionEvidence(value: CompletionEvidence) {
  if (value.status !== 'complete') return { ok: false, reason: `Execution status is ${value.status || 'missing'}.` };
  if (!value.appUrl || !/^http:\/\/127\.0\.0\.1:\d+\/?/.test(value.appUrl)) return { ok: false, reason: 'A verified private local application URL is required.' };
  const checks = new Map((value.verification || []).map((check) => [check.name, check]));
  for (const name of REQUIRED_GATES) {
    const check = checks.get(name);
    if (!check) return { ok: false, reason: `Missing completion gate: ${name}.` };
    if (check.status === 'failed' || check.status === 'pending' || check.status === 'running') {
      return { ok: false, reason: `Completion gate did not pass: ${name}.` };
    }
    if (check.status === 'skipped' && !check.detail) return { ok: false, reason: `Skipped gate lacks an applicability reason: ${name}.` };
  }
  return { ok: true, reason: '' };
}

function buildPrompt(input: {
  buildId: string;
  port: number;
  workspace: string;
  request: BuildRequest;
  steps: ExecutionStep[];
  completionPath: string;
}) {
  const localOnly = input.request.deployment !== 'vercel';
  return `AUTONOMOUS PROJECT BUILDER CHATGPT HANDOFF

You are the implementation worker for Autonomous Project Builder build ${input.buildId}.
You are running in the user's authenticated ChatGPT session and have the connected Computer 2 MCP available.

GOAL
${input.request.objective || 'Build the requested production application.'}

PROJECT NAME
${input.request.name || 'Local project'}

LOCAL WORKSPACE
${input.workspace}

CHATGPT + MCP EXECUTION RULES
- Use the connected Computer 2 MCP as your machine execution layer. Use its filesystem, terminal, job, browser, and local application tools as needed.
- Do not invoke Codex CLI, Gemini CLI, Claude Code, or another local coding-model CLI. ChatGPT is the implementation brain for this build.
- For authenticated browser work, use the real Computer 2 authenticated Chrome bridge and its authenticated_chrome_* tools. Do not replace the signed-in Chrome identity path with an unauthenticated Playwright browser.
- Use Docker MCP only for portable service integrations that this build actually requires.
- Use Windmill for durable workflow/schedule/orchestration steps when the execution route marks them for Windmill. Do not invent a cloud dependency for a local-only build.

EXECUTION CONTRACT
- If .builder/approved-brief.md exists, read it first. It is the immutable, user-approved execution contract and is authoritative for scope and acceptance criteria.
- This build direction is already approved. Start implementation immediately; do not pause for brainstorming, design review, plan approval, or routine confirmation.
- Do not create subagents or wait for another conversation. Finish the build through the connected MCP tools.
- Work only inside the local workspace above, except when inspecting/reusing existing machine resources or required service integrations.
- Produce a real, complete, production-ready application. No demo data, fake users, placeholder buttons, TODO implementations, or stale samples.
- Inspect existing resources before requesting accounts, credentials, subscriptions, hosting, databases, domains, APIs, or paid tools.
- ${localOnly ? 'Do not use GitHub or Vercel. Build and serve the application privately on Computer 2.' : 'Vercel is only an optional shipping destination for the generated project; the Builder itself remains local.'}
- The finished production application must listen on 127.0.0.1:${input.port} and remain running after implementation completes.
- Use a production start command, launch it as a hidden/detached local process where appropriate, and verify the HTTP response.
- Run dependency installation, lint, typecheck where applicable, unit tests, integration tests where applicable, production build, critical user-flow tests, runtime boot, HTTP/API checks, route/link checks, placeholder audit, and fatal console-error checks.
- Treat absent tools/services as recoverable when safe: repair/restart/install and retry. For deterministic lint, type, build, or test failures, diagnose and repair before retrying.
- Continue through YELLOW/recoverable issues. Stop only for a genuine user-only blocker.
- Never print or copy MCP tokens, cookies, passwords, authorization headers, or service secrets into application files, logs, or completion evidence.
- Do not claim success unless the completion evidence below is written and every applicable gate passes.

EXECUTION ROUTE
${input.steps.map((step, index) => `${index + 1}. [${step.target}] ${step.title}: ${step.reason}`).join('\n')}

COMPLETION EVIDENCE
Write UTF-8 JSON to this exact path:
${input.completionPath}

Use this shape:
{
  "status": "complete" | "blocked" | "failed",
  "appUrl": "http://127.0.0.1:${input.port}",
  "verification": [
    { "name": "dependencies|lint|typecheck|unit-tests|integration-tests|production-build|critical-flows|runtime|http|placeholder-audit", "status": "passed|failed|skipped", "detail": "evidence or explicit not-applicable reason" }
  ],
  "repairs": [{ "errorClass": "...", "diagnosis": "...", "repairAction": "...", "result": "..." }],
  "result": { "summary": "...", "runtimePid": 1234 }
}

Include all ten named verification gates exactly once. A skipped gate must explain why it is not applicable.
`;
}

function list(title: string, values: string[]) {
  return `## ${title}\n\n${values.length ? values.map((value) => `- ${value}`).join('\n') : '- None'}\n`;
}

export function writeApprovedBrief(input: {
  workspace: string;
  brief: BuildBrief;
  sources: SourceManifestItem[];
  decisions: BriefDecision[];
  buildConfiguration: ApprovalBuildConfiguration;
  approvalHash: string;
}) {
  const content = [
    '# Approved Build Brief', '',
    `Brief version: ${input.brief.version}`,
    `Approval contract: ${input.approvalHash}`, '',
    '## Outcome', '', input.brief.content.outcome, '',
    list('Users', input.brief.content.users),
    list('Critical flows', input.brief.content.flows),
    list('Requirements', input.brief.content.requirements),
    list('Design direction', input.brief.content.designDirection),
    list('Data and integrations', input.brief.content.dataAndIntegrations),
    list('Exclusions', input.brief.content.exclusions),
    list('Acceptance tests', input.brief.content.acceptanceTests),
    list('Approved assumptions', input.brief.content.assumptions),
    '## Resolved decisions', '',
    ...(input.decisions.length ? input.decisions.map((decision) => `- ${decision.question}: ${decision.resolution}`) : ['- None']), '',
    '## Source manifest', '',
    ...input.sources.map((source) => `- ${source.originalFilename} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· revision ${source.revision} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${source.mimeType} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· sha256 ${source.contentHash}`), '',
    '## Build configuration', '',
    `- Deployment: ${input.buildConfiguration.deployment}`,
    `- Repository: ${input.buildConfiguration.repository || 'none (private local workspace)'}`,
    `- Backend: ${input.buildConfiguration.backend}`,
    `- Workflow: ${input.buildConfiguration.workflow}`,
    `- Authenticated browser required: ${input.buildConfiguration.needsAuthenticatedBrowser ? 'yes' : 'no'}`,
    `- Windows host required: ${input.buildConfiguration.needsWindowsHost ? 'yes' : 'no'}`, '',
    `Visual coverage: ${input.brief.visualCoverage.inspectedPages}/${input.brief.visualCoverage.totalPages} pages inspected.`,
  ].join('\n');
  const path = join(input.workspace, '.builder', 'approved-brief.md');
  writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' });
  return path;
}
function psLiteral(value: string) {
  return value.replaceAll("'", "''");
}

export function prepareBuildWorkspace(input: {
  root: string;
  buildId: string;
  port: number;
  request: BuildRequest;
  steps: ExecutionStep[];
}) {
  const workspace = resolve(input.root, `${slugify(input.request.name || input.request.objective || 'local-project')}-${input.buildId.replace(/^build-/, '').slice(0, 8)}`);
  const controlDirectory = join(workspace, '.builder');
  mkdirSync(controlDirectory, { recursive: true });
  const promptPath = join(controlDirectory, 'request.md');
  const completionPath = join(controlDirectory, 'completion.json');
  const lastMessagePath = join(controlDirectory, 'last-message.txt');
  const scriptPath = join(controlDirectory, 'execute-build.ps1');
  const launcherPath = join(controlDirectory, 'launch-build.ps1');
  const heartbeatPath = join(controlDirectory, 'worker-heartbeat.json');
  const handoffPath = join(controlDirectory, 'chatgpt-handoff.json');
  const intakeWorkerPath = process.env.BUILDER_INTAKE_WORKER?.trim();
  const buildWorkerPath = process.env.BUILDER_BUILD_WORKER?.trim()
    || (intakeWorkerPath ? join(dirname(intakeWorkerPath), 'build-worker.mjs') : join(process.cwd(), 'dist-worker', 'build-worker.mjs'));
  const workerExecutable = process.execPath;
  const useElectronAsNode = process.env.ELECTRON_RUN_AS_NODE === '1';

  writeFileSync(
    promptPath,
    buildPrompt({ ...input, workspace, completionPath }),
    { encoding: 'utf8', mode: 0o600 },
  );

  const script = `$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$PID | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'worker.pid')
$runtime = '${psLiteral(workerExecutable)}'
$buildWorker = '${psLiteral(buildWorkerPath)}'
if (-not (Test-Path -LiteralPath $buildWorker)) { throw "Bundled ChatGPT build worker is missing: $buildWorker" }
if ('${useElectronAsNode ? '1' : '0'}' -eq '1') { $env:ELECTRON_RUN_AS_NODE = '1' }
$workerArgs = @(
  '--workspace', '${psLiteral(workspace)}',
  '--prompt', '${psLiteral(promptPath)}',
  '--completion', '${psLiteral(completionPath)}',
  '--last-message', '${psLiteral(lastMessagePath)}',
  '--heartbeat', '${psLiteral(heartbeatPath)}',
  '--handoff', '${psLiteral(handoffPath)}',
  '--build', '${psLiteral(input.buildId)}'
)
& $runtime $buildWorker @workerArgs
if ($LASTEXITCODE -ne 0) { throw "ChatGPT implementation worker exited with code $LASTEXITCODE" }
`;

  writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o700 });
  const taskName = `AutonomousBuilder-${input.buildId.replace(/[^a-zA-Z0-9-]/g, '')}`;
  const launcher = `$ErrorActionPreference = 'Stop'
$controlDirectory = Split-Path -Parent $PSCommandPath
$taskName = '${taskName}'
$argument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath.replaceAll('"', '`"')}"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory '${psLiteral(workspace)}'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddYears(10)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
$taskName | Set-Content -LiteralPath (Join-Path $controlDirectory 'worker.task')
Start-Sleep -Seconds 2
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
[pscustomobject]@{ launched = $true; task = $taskName; worker = 'chatgpt-mcp' } | ConvertTo-Json -Compress
`;
  writeFileSync(launcherPath, launcher, { encoding: 'utf8', mode: 0o700 });

  const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${launcherPath.replaceAll('"', '`"')}"`;
  return {
    workspace,
    controlDirectory,
    promptPath,
    completionPath,
    scriptPath,
    launcherPath,
    lastMessagePath,
    heartbeatPath,
    handoffPath,
    command,
    port: input.port,
    worker: 'chatgpt-mcp' as const,
  };
}