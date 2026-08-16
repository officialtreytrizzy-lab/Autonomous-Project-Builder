import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BuildRequest, ExecutionStep } from './builder';
import type { DesignContract } from './design/types';
import type { VerificationCheck } from './build-store';
import type { ApprovalBuildConfiguration, BriefDecision, BuildBrief, SourceManifestItem } from './intake/types';
import { targetIsWebRuntime, targetLabel, targetNeedsAppleBuildHost } from './target-platform.ts';

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
  screenshots?: Array<{ label: string; path: string; mimeType?: string }>;
  artifacts?: Array<{ kind: string; path: string; platform?: string; verified?: boolean }>;
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

export function validateCompletionEvidence(value: CompletionEvidence, target?: BuildRequest['target']) {
  if (value.status !== 'complete') return { ok: false, reason: `Execution status is ${value.status || 'missing'}.` };
  if (targetIsWebRuntime(target)) {
    if (!value.appUrl || !/^http:\/\/127\.0\.0\.1:\d+\/?/.test(value.appUrl)) return { ok: false, reason: 'A verified private local application URL is required for this web deliverable.' };
  } else if (!(value.artifacts || []).some((artifact) => artifact.path?.trim() && artifact.verified !== false)) {
    return { ok: false, reason: `A verified ${targetLabel(target)} build artifact is required.` };
  }
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
  existingWorkspace?: boolean;
}) {
  const localOnly = input.request.deployment !== 'vercel';
  const webTarget = targetIsWebRuntime(input.request.target);
  const selectedTarget = targetLabel(input.request.target);
  const appleTarget = targetNeedsAppleBuildHost(input.request.target);
  return `AUTONOMOUS PROJECT BUILDER CHATGPT HANDOFF

You are the implementation worker for Autonomous Project Builder build ${input.buildId}.
You are running in the user's authenticated ChatGPT session and have the connected Computer 2 MCP available.

GOAL
${input.request.objective || 'Build the requested production application.'}

PROJECT NAME
${input.request.name || 'Local project'}

LOCAL WORKSPACE
${input.workspace}

BUILD TARGET
${selectedTarget}

CHATGPT + MCP EXECUTION RULES
- Use the connected Computer 2 MCP as your machine execution layer. Use its filesystem, terminal, job, browser, and local application tools as needed.
- Do not invoke Codex CLI, Gemini CLI, Claude Code, or another local coding-model CLI. ChatGPT is the implementation brain for this build.
- For authenticated browser work, use the real Computer 2 authenticated Chrome bridge and its authenticated_chrome_* tools. Do not replace the signed-in Chrome identity path with an unauthenticated Playwright browser.
- Use Docker MCP only for portable service integrations that this build actually requires.
- Use Windmill for durable workflow/schedule/orchestration steps when the execution route marks them for Windmill. Do not invent a cloud dependency for a local-only build.

EXECUTION CONTRACT
- If .builder/approved-brief.md exists, read it first. It is the immutable, user-approved execution contract and is authoritative for scope and acceptance criteria.
- If the approved brief identifies an IMPLEMENTATION PLAN source, treat that imported plan as the primary implementation contract. Supporting references may complement it but must not override it. The retained originals are under .builder/intake-data/originals and begin with their source id; consult the original plan directly whenever exact implementation details matter.
- If .builder/approved-design.json exists, read it immediately after the approved brief. It is the immutable visual contract. Implement it exactly; do not reinterpret, simplify, substitute, or redesign it.
- If .builder/approved-design-renders/ exists, inspect every approved mockup image before coding. Those rendered pixels are the authoritative visual target; use approved-design.json for behavior, states, accessibility, and responsive details that a still image cannot show.
- If .builder/approved-requirements.json exists, read it before implementation. Every listed user-supplied asset, folder, dataset, reference, device/manual confirmation, or access requirement was collected before approval and is authoritative build input.
- Required file inputs are copied under .builder/user-inputs and may be used directly. Do not ask the user to upload them again.
- Credential values are NOT present in approved-requirements.json or this prompt. When a command genuinely needs a saved credential, run it through .builder/run-with-secrets.ps1 -Command "<command>"; that helper injects approved secrets only into the child process environment. Never open, decode, print, copy, or echo .builder/runtime-secrets.json.
- This build direction is already approved. Start implementation immediately; do not pause for brainstorming, design review, plan approval, or routine confirmation.
- Do not create subagents or wait for another conversation. Finish the build through the connected MCP tools.
- Work only inside the local workspace above, except when inspecting/reusing existing machine resources or required service integrations.
${input.existingWorkspace ? '- This workspace is an existing application or repository selected by the user. Inspect it first, preserve all working behavior, and modify it in place. Do not scaffold over, replace, reset, or delete the existing app unless the approved outcome explicitly requires that change.\r\n' : ''}- Produce a real, complete, production-ready application. No demo data, fake users, placeholder buttons, TODO implementations, or stale samples.
- The BUILD TARGET above is authoritative. Never substitute a browser app when an APK, AAB, IPA, EXE, MSIX, DMG, PKG, TV package, or combined platform deliverable was approved.
- For Android / Android TV / Fire OS packages, verify or install the Android SDK/Gradle packaging toolchain as needed and verify the produced APK/AAB.
${appleTarget ? '- Apple-native packaging/signing requires a macOS/Xcode-capable build environment. Inspect and reuse any existing configured Apple build resource first. If no legitimate Apple build environment exists, report a real blocker instead of fabricating an IPA/DMG/PKG.\n' : ''}- Inspect existing resources before requesting accounts, credentials, subscriptions, hosting, databases, domains, APIs, or paid tools.
- ${localOnly ? 'Do not use GitHub or Vercel. Build and serve the application privately on Computer 2.' : 'Vercel is only an optional shipping destination for the generated project; the Builder itself remains local.'}
${webTarget ? `- The finished production application must listen on 127.0.0.1:${input.port} and remain running after implementation completes.\n- Use a production start command, launch it as a hidden/detached local process where appropriate, and verify the HTTP response.\n` : `- The primary completion output is the approved ${selectedTarget} artifact. A local preview may be used for QA, but it does not replace the requested installable/package deliverable.\n- Record absolute paths to every requested package in completion.json and verify the files exist and are structurally usable.\n`}
- Run dependency installation, lint, typecheck where applicable, unit tests, integration tests where applicable, production build/package, critical user-flow tests, runtime checks where applicable, HTTP/API checks where applicable, route/link checks where applicable, placeholder audit, and fatal console-error checks. Native-only runtime/http gates may be skipped only with an explicit not-applicable reason.
- Treat absent tools/services as recoverable when safe: repair/restart/install and retry. For deterministic lint, type, build, or test failures, diagnose and repair before retrying.
- Continue through YELLOW/recoverable issues. Stop only for a genuine user-only blocker.
- Never print or copy MCP tokens, cookies, passwords, authorization headers, or service secrets into application files, logs, or completion evidence.
- Do not claim success unless the completion evidence below is written and every applicable gate passes.
- DESIGN VISUAL QA: If .builder/approved-design.json exists, capture the finished running app at both desktop (1440x1000) and mobile (390x844) viewport sizes before writing completion. Save PNG screenshots inside this project workspace under .builder/visual-qa/ and include their absolute paths in the completion evidence. If .builder/design-qa.json exists, it contains authoritative visual mismatches from the design director; repair every listed mismatch, recapture both screenshots, then replace completion evidence.

EXECUTION ROUTE
${input.steps.map((step, index) => `${index + 1}. [${step.target}] ${step.title}: ${step.reason}`).join('\n')}

COMPLETION EVIDENCE
Write UTF-8 JSON to this exact path:
${input.completionPath}

Use this shape:
{
  "status": "complete" | "blocked" | "failed",
  "appUrl": "${webTarget ? `http://127.0.0.1:${input.port}` : ``}",
  "artifacts": [{ "kind": "requested deliverable", "path": "absolute artifact path inside workspace", "platform": "target platform", "verified": true }],
  "verification": [
    { "name": "dependencies|lint|typecheck|unit-tests|integration-tests|production-build|critical-flows|runtime|http|placeholder-audit", "status": "passed|failed|skipped", "detail": "evidence or explicit not-applicable reason" }
  ],
  "repairs": [{ "errorClass": "...", "diagnosis": "...", "repairAction": "...", "result": "..." }],
  "screenshots": [{ "label": "desktop|mobile", "path": "absolute PNG path inside workspace", "mimeType": "image/png" }],
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
    '## Required user-supplied inputs', '',
    ...(input.brief.requiredInputs.length ? input.brief.requiredInputs.map((requirement) => `- ${requirement.required ? 'REQUIRED' : 'Optional'} | ${requirement.kind} | ${requirement.label}: ${requirement.description}  -  ${requirement.reason}`) : ['- None']), '',
    '## Resolved decisions', '',
    ...(input.decisions.length ? input.decisions.map((decision) => `- ${decision.question}: ${decision.resolution}`) : ['- None']), '',
    '## Source manifest', '',
    'Sources marked IMPLEMENTATION PLAN are authoritative. Other sources are supporting references and may not silently override the implementation plan.', '',
    ...input.sources.map((source) => `- ${source.role === 'implementation-plan' ? 'IMPLEMENTATION PLAN' : 'Reference'} | source ${source.sourceId} | ${source.originalFilename} | revision ${source.revision} | ${source.mimeType} | sha256 ${source.contentHash}`), '',
    '## Build configuration', '',
    `- Deployment: ${input.buildConfiguration.deployment}`,
    `- Repository: ${input.buildConfiguration.repository || 'none (private local workspace)'}`,
    `- Backend: ${input.buildConfiguration.backend}`,
    `- Workflow: ${input.buildConfiguration.workflow}`,
    `- Authenticated browser required: ${input.buildConfiguration.needsAuthenticatedBrowser ? 'yes' : 'no'}`,
    `- Windows host required: ${input.buildConfiguration.needsWindowsHost ? 'yes' : 'no'}`,
    `- Build target: ${targetLabel(input.buildConfiguration.target)}`, '',
    `Visual coverage: ${input.brief.visualCoverage.inspectedPages}/${input.brief.visualCoverage.totalPages} pages inspected.`,
  ].join('\n');
  const controlDirectory = join(input.workspace, '.builder');
  const archiveDirectory = join(controlDirectory, 'approved-briefs');
  mkdirSync(archiveDirectory, { recursive: true });
  const archivedPath = join(archiveDirectory, `${input.approvalHash}.md`);
  if (!existsSync(archivedPath)) writeFileSync(archivedPath, content, { encoding: 'utf8', flag: 'wx' });
  const path = join(controlDirectory, 'approved-brief.md');
  writeFileSync(path, content, { encoding: 'utf8' });
  return path;
}
export function writeApprovedDesign(input: { workspace: string; design: DesignContract; approvalHash: string }) {
  const controlDirectory = join(input.workspace, '.builder');
  const archiveDirectory = join(controlDirectory, 'approved-designs');
  const renderArchiveDirectory = join(controlDirectory, 'approved-design-renders', input.approvalHash);
  mkdirSync(archiveDirectory, { recursive: true });
  mkdirSync(renderArchiveDirectory, { recursive: true });

  const approvedMockups = (input.design.mockups || []).map((mockup) => {
    const source = join(controlDirectory, 'design-mockups', input.design.intakeId, mockup.fileName);
    const destination = join(renderArchiveDirectory, mockup.fileName);
    if (!existsSync(source)) throw new Error(`Approved design mockup is missing: ${mockup.label}`);
    if (!existsSync(destination)) copyFileSync(source, destination);
    return {
      ...mockup,
      approvedRelativePath: `.builder/approved-design-renders/${input.approvalHash}/${mockup.fileName}`,
    };
  });
  const designWithAssets: DesignContract = { ...input.design, mockups: approvedMockups };
  const json = JSON.stringify({ approvalHash: input.approvalHash, ...designWithAssets }, null, 2);
  const markdown = [
    '# Approved Visual Design', '',
    `Design version: ${input.design.version}`,
    `Design model: ${input.design.model}`,
    `Approval contract: ${input.approvalHash}`, '',
    '## Approved visual Design Package', '',
    ...(approvedMockups.length
      ? approvedMockups.map((mockup) => `- ${mockup.label}: ${mockup.approvedRelativePath} (${mockup.model}, ${mockup.imageSize}, ${mockup.aspectRatio})`)
      : ['- None']), '',
    '## Summary', '', input.design.summary, '',
    list('Design principles', input.design.principles),
    '## Design system', '',
    `Visual language: ${input.design.designSystem.visualLanguage}`, '',
    list('Typography', input.design.designSystem.typography),
    list('Color and material', input.design.designSystem.colorAndMaterial),
    list('Spacing and shape', input.design.designSystem.spacingAndShape),
    list('Elevation and depth', input.design.designSystem.elevationAndDepth),
    list('Motion', input.design.designSystem.motion),
    '## Screens', '',
    ...input.design.screens.flatMap((screen) => [
      `### ${screen.name}`, '', screen.purpose, '',
      list('Layout', screen.layout),
      list('Components', screen.components),
      list('States', screen.states),
      list('Mobile', screen.mobile),
      list('Desktop', screen.desktop),
    ]),
    list('Interactions', input.design.interactions),
    list('Responsive rules', input.design.responsiveRules),
    list('Accessibility', input.design.accessibility),
    list('Assets', input.design.assets),
    list('Implementation rules', input.design.implementationRules),
    list('Visual acceptance', input.design.visualAcceptance),
  ].join('\n');
  const archiveJson = join(archiveDirectory, `${input.approvalHash}.json`);
  const archiveMd = join(archiveDirectory, `${input.approvalHash}.md`);
  if (!existsSync(archiveJson)) writeFileSync(archiveJson, json, { encoding: 'utf8', flag: 'wx' });
  if (!existsSync(archiveMd)) writeFileSync(archiveMd, markdown, { encoding: 'utf8', flag: 'wx' });
  writeFileSync(join(controlDirectory, 'approved-design.json'), json, { encoding: 'utf8' });
  writeFileSync(join(controlDirectory, 'approved-design.md'), markdown, { encoding: 'utf8' });
  return join(controlDirectory, 'approved-design.json');
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
  workspace?: string;
  existingWorkspace?: boolean;
}) {
  const workspace = input.workspace
    ? resolve(input.workspace)
    : resolve(input.root, `${slugify(input.request.name || input.request.objective || 'local-project')}-${input.buildId.replace(/^build-/, '').slice(0, 8)}`);
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
