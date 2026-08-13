# Premium Multimodal Autonomous Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the installed Autonomous Project Builder with private multimodal document understanding, an immutable pre-build approval contract, deterministic live progress, and a premium Precision Liquid Glass desktop experience.

**Architecture:** Add a versioned intake domain beside the existing build domain, backed by the same local SQLite database and Computer 2 durable job runner. A bundled local worker extracts and renders documents, uses conditional OCR and an Ollama vision-capable model, persists page evidence and a Build Brief, and issues an approval hash that the existing BuildService must validate. Persisted monotonic events drive SSE, the human timeline, technical logs, and the Living Build Spine.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node SQLite, Computer 2 MCP/job runner, Ollama local REST API, Microsoft Word local conversion, `pdfjs-dist@6.2.108`, `mammoth@1.12.1`, `file-type@22.0.1`, Electron 43, electron-builder/NSIS, Node test runner, Playwright, CSS animations, bundled Fontsource fonts.

**Spec:** `docs/superpowers/specs/2026-08-13-premium-multimodal-builder-design.md`

## Global Constraints

- Preserve Computer 2 MCP, Docker MCP, Windmill, authenticated Chrome, the job runner, retry/error classifier, and restart recovery.
- The Builder remains local/private on `127.0.0.1:3107`; Computer 2 MCP retains port `3000`.
- Every PDF page must receive visual inspection before approval.
- Native text extraction is preferred; OCR runs only for scanned or non-machine-readable content.
- Originals and derived evidence stay local unless the user explicitly authorizes a source-specific external analysis step.
- An approved Build Brief is an immutable execution contract.
- SQLite is authoritative; SSE only transports persisted events.
- Never fabricate progress percentages, stages, repairs, or completion.
- Never expose tokens, cookies, passwords, authorization headers, source absolute paths, or private evidence to frontend bundles or logs.
- A local build must not require Docker MCP, Windmill, GitHub, or Vercel when the approved contract does not need them.
- Use `gemma3:4b` only as the provisionable default after capability discovery/repair finds no installed local model whose Ollama `/api/show` capabilities include `vision`.
- Respect `prefers-reduced-motion`, keyboard navigation, visible focus, and contrast-safe glass.

---

## File Map

### Intake domain

- `src/lib/intake/types.ts` — shared source, evidence, brief, approval, project-state, and event types.
- `src/lib/intake/contract.ts` — normalization, material-change detection, and deterministic approval hashing.
- `src/lib/intake/store.ts` — SQLite schema and authoritative intake/project/event persistence.
- `src/lib/intake/files.ts` — safe filenames, signature validation, streaming storage, replacement, deletion, and local paths.
- `src/lib/intake/capabilities.ts` — Word, PDF renderer, Ollama, model discovery, repair, and provisioning decisions.
- `src/lib/intake/documents.ts` — native extraction, fixed-layout conversion, page rendering, and conditional OCR decisions.
- `src/lib/intake/vision.ts` — local Ollama visual evidence and structured brief synthesis.
- `src/lib/intake/worker.ts` — checkpointed document/page pipeline used by the bundled worker.
- `src/lib/intake/service.ts` — Computer 2 plan/job submission, status, cancellation, and restart resume.
- `workers/intake-worker.mjs` — bundled command entry that runs one persisted intake job.
- `scripts/build-intake-worker.mjs` — esbuild configuration for the standalone worker artifact.

### APIs

- `src/app/api/projects/route.ts`
- `src/app/api/intakes/[intakeId]/route.ts`
- `src/app/api/intakes/[intakeId]/sources/route.ts`
- `src/app/api/intakes/[intakeId]/sources/[sourceId]/route.ts`
- `src/app/api/intakes/[intakeId]/sources/[sourceId]/pages/[page]/route.ts`
- `src/app/api/intakes/[intakeId]/analyze/route.ts`
- `src/app/api/intakes/[intakeId]/brief/route.ts`
- `src/app/api/intakes/[intakeId]/decisions/route.ts`
- `src/app/api/intakes/[intakeId]/approve/route.ts`
- `src/app/api/events/route.ts`
- `src/app/api/builds/start/route.ts` — require the approved contract.

### UI

- `src/app/page.tsx` — thin project shell and mode coordinator.
- `src/components/builder/ProjectRail.tsx`
- `src/components/builder/ComposeMode.tsx`
- `src/components/builder/SourceManager.tsx`
- `src/components/builder/UnderstandMode.tsx`
- `src/components/builder/EvidenceViewer.tsx`
- `src/components/builder/ApprovalMode.tsx`
- `src/components/builder/BuildMode.tsx`
- `src/components/builder/LivingBuildSpine.tsx`
- `src/components/builder/EventStream.tsx`
- `src/components/builder/SystemHealth.tsx`
- `src/hooks/useProjectEvents.ts`
- `src/app/globals.css` — token system, continuous glass environment, responsive layout, and motion.

### Tests and fixtures

- `tests/intake-contract.test.mjs`
- `tests/intake-store.test.mjs`
- `tests/intake-files.test.mjs`
- `tests/intake-capabilities.test.mjs`
- `tests/intake-documents.test.mjs`
- `tests/intake-worker.integration.test.mjs`
- `tests/intake-service.integration.test.mjs`
- `tests/approval-build.integration.test.mjs`
- `tests/project-events.test.mjs`
- `tests/premium-ui.test.mjs`
- `tests/fixtures/create-intake-fixtures.mjs`
- `tests/e2e/premium-builder.spec.mjs`

---

### Task 1: Intake Types, Materiality, and Approval Contract

**Files:**
- Create: `src/lib/intake/types.ts`
- Create: `src/lib/intake/contract.ts`
- Create: `tests/intake-contract.test.mjs`

**Interfaces:**
- Produces: `SourceManifestItem`, `EvidenceRecord`, `BuildBrief`, `BriefDecision`, `ApprovalContract`, `ProjectEvent`, `computeApprovalHash(input)`, and `isMaterialContractChange(before, after)`.
- Consumes: Node `crypto`; no database or network dependency.

- [ ] **Step 1: Write failing contract tests**

```js
test('approval hash is stable across harmless metadata changes', () => {
  const one = contractFixture();
  const two = structuredClone(one);
  two.sources[0].originalFilename = 'renamed.pdf';
  two.sources[0].ingestedAt = '2030-01-01T00:00:00.000Z';
  assert.equal(computeApprovalHash(one), computeApprovalHash(two));
});

test('source content, decision, or build configuration changes invalidate approval', () => {
  const base = contractFixture();
  for (const mutate of [
    (value) => { value.sources[0].contentHash = 'changed'; },
    (value) => { value.decisions[0].resolution = 'changed'; },
    (value) => { value.buildConfiguration.deployment = 'vercel'; },
  ]) {
    const changed = structuredClone(base);
    mutate(changed);
    assert.notEqual(computeApprovalHash(base), computeApprovalHash(changed));
    assert.equal(isMaterialContractChange(base, changed), true);
  }
});
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `node --test --experimental-strip-types tests/intake-contract.test.mjs`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/intake/contract.ts`.

- [ ] **Step 3: Implement canonical hashing and exact domain types**

```ts
export function computeApprovalHash(input: ApprovalHashInput) {
  const canonical = {
    brief: { version: input.brief.version, content: input.brief.content },
    sources: input.sources.map(({ sourceId, revision, contentHash, mimeType, availability }) =>
      ({ sourceId, revision, contentHash, mimeType, availability })).sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    decisions: input.decisions.map(({ decisionId, resolution }) => ({ decisionId, resolution }))
      .sort((a, b) => a.decisionId.localeCompare(b.decisionId)),
    buildConfiguration: input.buildConfiguration,
  };
  return createHash('sha256').update(stableJson(canonical)).digest('hex');
}
```

- [ ] **Step 4: Run contract tests**

Run: `node --test --experimental-strip-types tests/intake-contract.test.mjs`  
Expected: PASS with all material and non-material cases.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/intake/types.ts src/lib/intake/contract.ts tests/intake-contract.test.mjs
git commit -m "feat: define immutable intake approval contract"
```

### Task 2: Authoritative Intake and Ordered Event Store

**Files:**
- Create: `src/lib/intake/store.ts`
- Create: `tests/intake-store.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 1 domain types.
- Produces: `IntakeStore`, `getIntakeStore()`, `createProject()`, `createIntake()`, `addSourceRevision()`, `recordEvidence()`, `createBriefVersion()`, `resolveDecision()`, `approve()`, `appendEvent()`, and `eventsAfter()`.

- [ ] **Step 1: Write failing SQLite lifecycle tests**

```js
test('store persists immutable source revisions and monotonic events', () => {
  const store = new IntakeStore(dbPath);
  const project = store.createProject({ name: 'Restaurant Flow', objective: 'Build ordering software' });
  const intake = store.createIntake(project.id);
  const first = store.addSourceRevision(intake.id, sourceInput({ contentHash: 'hash-1' }));
  const second = store.addSourceRevision(intake.id, sourceInput({ sourceId: first.sourceId, revision: 2, contentHash: 'hash-2' }));
  assert.equal(second.replacesRevisionId, first.revisionId);
  const e1 = store.appendEvent(eventInput(project.id, 'source stored'));
  const e2 = store.appendEvent(eventInput(project.id, 'source replaced'));
  assert.equal(e2.sequence, e1.sequence + 1);
  store.close();
  assert.equal(new IntakeStore(dbPath).eventsAfter(project.id, e1.sequence)[0].eventId, e2.eventId);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test --experimental-strip-types tests/intake-store.test.mjs`  
Expected: FAIL because `IntakeStore` does not exist.

- [ ] **Step 3: Implement WAL schema and atomic sequence allocation**

Create tables for `projects`, `intakes`, `source_revisions`, `evidence`, `brief_versions`, `brief_decisions`, `approval_contracts`, and `project_events`. Allocate event sequences inside `BEGIN IMMEDIATE`:

```ts
const current = database.prepare('SELECT COALESCE(MAX(sequence), 0) AS value FROM project_events WHERE project_id = ?')
  .get(projectId) as { value: number };
const sequence = current.value + 1;
database.prepare(`INSERT INTO project_events
  (event_id, project_id, sequence, created_at, event_json) VALUES (?, ?, ?, ?, ?)`)
  .run(eventId, projectId, sequence, timestamp, JSON.stringify(redactSecrets(event)));
```

- [ ] **Step 4: Prove persistence, ordering, tombstones, and restart recovery**

Run: `node --test --experimental-strip-types tests/intake-store.test.mjs`  
Expected: PASS, including a new-store-instance recovery assertion.

- [ ] **Step 5: Commit**

```powershell
git add .gitignore src/lib/intake/store.ts tests/intake-store.test.mjs
git commit -m "feat: persist multimodal intake and project events"
```

### Task 3: Secure Local Source Storage

**Files:**
- Create: `src/lib/intake/files.ts`
- Create: `tests/intake-files.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `IntakeStore.addSourceRevision()` and project workspace paths.
- Produces: `validateSource(bytes, filename)`, `normalizeSourceFilename(filename)`, `storeSource(stream, context)`, `replaceSource()`, and `tombstoneSource()`.

- [ ] **Step 1: Install the exact signature detection dependency**

Run: `npm install --save-exact file-type@22.0.1`  
Expected: package lock records `file-type@22.0.1` with zero audit vulnerabilities introduced.

- [ ] **Step 2: Write traversal, spoofing, streaming, and replacement tests**

```js
test('source storage rejects traversal and MIME spoofing', async () => {
  assert.equal(normalizeSourceFilename('..\\..\\brief.pdf'), 'brief.pdf');
  await assert.rejects(
    () => validateSource(Buffer.from('not a pdf'), 'brief.pdf'),
    /signature does not match/i,
  );
});

test('replacement keeps an immutable original revision', async () => {
  const first = await storeFixture.upload('flow.pdf', pdfOne);
  const second = await storeFixture.replace(first.sourceId, 'flow.pdf', pdfTwo);
  assert.notEqual(first.path, second.path);
  assert.equal(existsSync(first.path), true);
  assert.equal(second.revision, 2);
});
```

- [ ] **Step 3: Run and confirm failures**

Run: `node --test --experimental-strip-types tests/intake-files.test.mjs`  
Expected: FAIL for missing file-storage functions.

- [ ] **Step 4: Implement streamed storage with SHA-256 and server-only paths**

Use a randomly named temporary file under `intake/originals/.incoming`, hash while streaming, validate the detected signature, then atomically rename to `<sourceId>-r<revision>.<ext>`. Enforce 100 MiB per source and 20 sources per intake. Return public metadata without `localPath`.

- [ ] **Step 5: Run file tests and the secret-redaction regression**

Run: `node --test --experimental-strip-types tests/intake-files.test.mjs tests/build-store.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json src/lib/intake/files.ts tests/intake-files.test.mjs
git commit -m "feat: store private intake sources safely"
```

### Task 4: Local Document and Vision Capability Discovery

**Files:**
- Create: `src/lib/intake/capabilities.ts`
- Create: `tests/intake-capabilities.test.mjs`
- Modify: `src/lib/health.ts`
- Modify: `tests/health.test.mjs`

**Interfaces:**
- Produces: `discoverDocumentCapabilities(deps)`, `recoverVisionCapability(deps)`, and `DocumentCapabilityReport`.
- Uses: local Ollama `/api/tags`, `/api/show`, and `/api/version`; `/api/show.capabilities` must include `vision`.

- [ ] **Step 1: Write discovery-order and recovery tests**

```js
test('vision recovery diagnoses before provisioning', async () => {
  const actions = [];
  const report = await recoverVisionCapability(fakeCapabilityDeps({ actions, serviceStopped: true, installedVisionModel: 'existing-vision' }));
  assert.deepEqual(actions, ['discover', 'start-service', 'health-check']);
  assert.equal(report.model, 'existing-vision');
  assert.equal(actions.includes('pull-gemma3:4b'), false);
});

test('provisions gemma3:4b only after compatible discovery is exhausted', async () => {
  const actions = [];
  await recoverVisionCapability(fakeCapabilityDeps({ actions, noCompatibleModel: true }));
  assert.deepEqual(actions.slice(-2), ['pull-gemma3:4b', 'health-check']);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test --experimental-strip-types tests/intake-capabilities.test.mjs`  
Expected: FAIL because the capability module is missing.

- [ ] **Step 3: Implement discovery and bounded recovery**

Discovery checks Word COM availability, a configured/bundled PDF renderer, Ollama process/API health, installed model tags, and `/api/show` capabilities. Recovery performs discover → start → repair path/config → restart → provision → health-check. It never logs source content or tokens.

- [ ] **Step 4: Add quiet optional health reporting**

Add `documentVision` as an optional capability until a visual intake requires it. While such an intake is active, its unavailable state blocks approval but does not make unrelated local builds globally unready.

- [ ] **Step 5: Run capability and health tests**

Run: `node --test --experimental-strip-types tests/intake-capabilities.test.mjs tests/health.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/intake/capabilities.ts src/lib/health.ts tests/intake-capabilities.test.mjs tests/health.test.mjs
git commit -m "feat: recover local document vision capability"
```

### Task 5: Extraction, Rendering, Conditional OCR, and Visual Evidence

**Files:**
- Create: `src/lib/intake/documents.ts`
- Create: `src/lib/intake/vision.ts`
- Create: `tests/intake-documents.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: source revisions and `DocumentCapabilityReport`.
- Produces: `extractDocument(source, deps)`, `renderPages(document, deps)`, `needsOcr(page)`, `inspectPage(page, visionClient)`, and `synthesizeBrief(evidence, visionClient)`.

- [ ] **Step 1: Install exact extraction and bundled-font dependencies**

Run:

```powershell
npm install --save-exact pdfjs-dist@6.2.108 mammoth@1.12.1 `
  @fontsource-variable/sora@5.3.0 @fontsource-variable/manrope@5.3.0 `
  @fontsource/ibm-plex-mono@5.3.0
```

Expected: dependencies and lockfile update successfully.

- [ ] **Step 2: Write page-coverage and conditional-OCR tests**

```js
test('every PDF page is inspected while OCR remains conditional', async () => {
  const calls = [];
  const result = await processDocument(pdfFixture, fakeDocumentDeps({
    pages: [
      { page: 1, nativeText: 'Checkout requirements', imagePath: 'p1.png' },
      { page: 2, nativeText: '', imagePath: 'p2.png' },
    ],
    calls,
  }));
  assert.deepEqual(calls.filter((entry) => entry.kind === 'vision').map((entry) => entry.page), [1, 2]);
  assert.deepEqual(calls.filter((entry) => entry.kind === 'ocr').map((entry) => entry.page), [2]);
  assert.equal(result.visualCoverage.complete, true);
});

test('an uninspected page blocks brief approval', async () => {
  const result = await processDocument(pdfFixture, fakeDocumentDeps({ failVisionPage: 2 }));
  assert.equal(result.visualCoverage.complete, false);
  assert.equal(result.blockingIssues[0].code, 'page_visual_inspection_incomplete');
});
```

- [ ] **Step 3: Run and confirm failures**

Run: `node --test --experimental-strip-types tests/intake-documents.test.mjs`  
Expected: FAIL for missing document pipeline.

- [ ] **Step 4: Implement native extraction and fixed-layout rendering**

Use `pdfjs-dist` for PDF text/structure. Use `mammoth` for DOCX native text and embedded media. Use local Word conversion for DOC/DOCX fixed-layout pages when available. Render all pages into `intake/derived/<sourceId>/r<revision>/pages/` through a configured/bundled renderer.

- [ ] **Step 5: Implement structured local visual analysis**

Call Ollama `/api/chat` with base64 page images, `stream: false`, and a JSON schema that returns:

```ts
type PageVisualResult = {
  pageSummary: string;
  meaningfulVisuals: Array<{
    kind: 'ui' | 'diagram' | 'table' | 'chart' | 'drawing' | 'annotation' | 'layout' | 'other';
    description: string;
    relationships: string[];
    region?: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
  ocrText?: string;
  uncertainties: string[];
};
```

- [ ] **Step 6: Run document tests**

Run: `node --test --experimental-strip-types tests/intake-documents.test.mjs`  
Expected: PASS with all pages visually covered and OCR only on unreadable pages.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json src/lib/intake/documents.ts src/lib/intake/vision.ts tests/intake-documents.test.mjs
git commit -m "feat: understand text and visuals in local documents"
```

### Task 6: Durable Intake Worker and Computer 2 Job Integration

**Files:**
- Create: `src/lib/intake/worker.ts`
- Create: `src/lib/intake/service.ts`
- Create: `workers/intake-worker.mjs`
- Create: `scripts/build-intake-worker.mjs`
- Create: `tests/intake-worker.integration.test.mjs`
- Create: `tests/intake-service.integration.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 2 store, Task 4 capability recovery, Task 5 processors, and `callComputer2`.
- Produces: `IntakeService.analyze(intakeId)`, `refresh(intakeId)`, `cancel(intakeId)`, and `resumeInterrupted()`.

- [ ] **Step 1: Add a pinned worker bundler**

Run: `npm install --save-dev --save-exact esbuild@0.28.2`  
Expected: `esbuild` is pinned and the audit remains clean.

- [ ] **Step 2: Write failing durable-worker tests**

```js
test('intake service submits one persisted Computer 2 job and resumes it', async () => {
  const f = intakeServiceFixture();
  const intake = await f.service.analyze(f.intakeId);
  assert.match(intake.jobId, /^job-/);
  assert.equal(f.calls.some((call) => call.tool === 'plan_create'), true);
  assert.equal(f.calls.some((call) => call.tool === 'job_submit'), true);
  await f.service.resumeInterrupted();
  assert.equal(f.calls.some((call) => call.tool === 'job_resume'), true);
});

test('worker checkpoints each page and resumes without reprocessing completed pages', async () => {
  await runIntakeWorker(workerFixture({ interruptAfterPage: 1 }));
  await runIntakeWorker(workerFixture({ resume: true }));
  assert.deepEqual(processedPages(), [1, 2, 3]);
});
```

- [ ] **Step 3: Run and confirm failures**

Run: `node --test --experimental-strip-types tests/intake-worker.integration.test.mjs tests/intake-service.integration.test.mjs`  
Expected: FAIL for missing worker and service.

- [ ] **Step 4: Implement idempotent worker stages**

Persist before/after events for validation, extraction, rendering, each page inspection, evidence merge, conflict detection, and synthesis. Check existing evidence before every unit so replay is idempotent.

- [ ] **Step 5: Implement Computer 2 plan/job lifecycle**

Submit the bundled worker through `plan_create` and `job_submit` with project workspace as `cwd`. Persist plan/job IDs. Use existing `job_status`, `job_result`, `job_cancel`, and global `job_resume` behavior rather than introducing another retry engine.

- [ ] **Step 6: Bundle and smoke-run the worker**

Add:

```json
"intake:worker:build": "node scripts/build-intake-worker.mjs"
```

Run: `npm run intake:worker:build`  
Expected: `dist-worker/intake-worker.mjs` exists and accepts `--validate` without accessing sources.

- [ ] **Step 7: Run worker/service tests**

Run: `node --test --experimental-strip-types tests/intake-worker.integration.test.mjs tests/intake-service.integration.test.mjs`  
Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add .gitignore package.json package-lock.json src/lib/intake/worker.ts src/lib/intake/service.ts workers/intake-worker.mjs scripts/build-intake-worker.mjs tests/intake-worker.integration.test.mjs tests/intake-service.integration.test.mjs
git commit -m "feat: run document understanding through Computer 2 jobs"
```

### Task 7: Approval-Gated Build Start

**Files:**
- Create: `tests/approval-build.integration.test.mjs`
- Modify: `src/lib/build-service.ts`
- Modify: `src/lib/build-execution.ts`
- Modify: `src/lib/build-store.ts`
- Modify: `src/app/api/builds/start/route.ts`
- Modify: `tests/build-service.integration.test.mjs`
- Modify: `tests/builder-regression.test.mjs`

**Interfaces:**
- Consumes: `ApprovalContract`, current source manifest, decisions, and build configuration.
- Produces: `BuildService.startApproved({ intakeId, approvalHash })`; new UI/API builds cannot start from raw unapproved objectives.

- [ ] **Step 1: Write stale/missing approval tests**

```js
test('build start rejects missing and stale approval contracts', async () => {
  await assert.rejects(() => service.startApproved({ intakeId, approvalHash: '' }), /approval required/i);
  await assert.rejects(() => service.startApproved({ intakeId, approvalHash: 'stale' }), /approval no longer matches/i);
  assert.equal(computer2Calls.length, 0);
});

test('approved brief is copied into the immutable worker request', async () => {
  const build = await service.startApproved({ intakeId, approvalHash: validHash });
  const request = readFileSync(join(build.workspace, '.builder', 'approved-brief.md'), 'utf8');
  assert.match(request, /Acceptance tests/);
  assert.equal(build.approvalHash, validHash);
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `node --test --experimental-strip-types tests/approval-build.integration.test.mjs`  
Expected: FAIL because approved starts are not enforced.

- [ ] **Step 3: Implement approval validation and immutable brief handoff**

Recompute the current contract hash immediately before workspace/job creation. Store `intakeId`, `briefVersionId`, and `approvalHash` on the build record. Write the approved brief and a source/decision summary into `.builder` without absolute source paths or source contents not required for execution.

- [ ] **Step 4: Preserve read-only legacy history compatibility**

Existing historical builds remain viewable. Only new build-start requests require `intake_id` and `approval_hash`; no migration rewrites old completed records.

- [ ] **Step 5: Run approval and build regressions**

Run: `node --test --experimental-strip-types tests/approval-build.integration.test.mjs tests/build-service.integration.test.mjs tests/builder-regression.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/build-service.ts src/lib/build-execution.ts src/lib/build-store.ts src/app/api/builds/start/route.ts tests/approval-build.integration.test.mjs tests/build-service.integration.test.mjs tests/builder-regression.test.mjs
git commit -m "feat: require immutable brief approval before builds"
```

### Task 8: Persisted Project Event Stream and SSE Replay

**Files:**
- Create: `src/app/api/events/route.ts`
- Create: `src/hooks/useProjectEvents.ts`
- Create: `tests/project-events.test.mjs`
- Modify: `src/lib/build-service.ts`
- Modify: `src/lib/intake/service.ts`
- Modify: `src/lib/build-execution.ts`

**Interfaces:**
- Consumes: `IntakeStore.appendEvent()` and `eventsAfter()`.
- Produces: SSE frames with `id: <eventId>`, sequence-bearing JSON data, heartbeat comments, and polling fallback from the same database.

- [ ] **Step 1: Write ordered replay and deduplication tests**

```js
test('event endpoint replays only events after Last-Event-ID in sequence order', async () => {
  const events = seedEvents(4);
  const response = await GET(eventRequest({ lastEventId: events[1].eventId }));
  const frames = await readSseFrames(response);
  assert.deepEqual(frames.map((frame) => frame.data.sequence), [3, 4]);
  assert.equal(new Set(frames.map((frame) => frame.id)).size, 2);
});

test('spine projection uses persisted stages and repair branches only', () => {
  const projection = projectSpine([
    event({ sequence: 1, category: 'stage', stage: 'implementation' }),
    event({ sequence: 2, category: 'repair', stage: 'implementation' }),
    event({ sequence: 3, category: 'recovered', stage: 'implementation' }),
  ]);
  assert.equal(projection.nodes[0].repairBranches.length, 1);
  assert.equal(projection.nodes[0].repairBranches[0].reconnected, true);
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `node --test --experimental-strip-types tests/project-events.test.mjs`  
Expected: FAIL for missing event endpoint/projection.

- [ ] **Step 3: Emit persisted events from intake and build transitions**

Run the existing Codex implementation worker with `exec --json`, write its JSONL stream to `.builder/worker.events.jsonl`, and incrementally ingest completed tool/action records without exposing model reasoning. Map real job status, structured worker records, repair attempts, verification results, and runtime launch into `ProjectEvent`. Human messages are active voice and specific; technical payloads retain redacted evidence. Persist the last byte offset/checkpoint so restart parsing never duplicates events.

- [ ] **Step 4: Implement SSE and hook fallback**

The route queries by project and sequence, writes persisted events, sends a heartbeat every 15 seconds, and closes on request abort. The hook tracks the highest sequence, ignores duplicates, reconnects with `Last-Event-ID`, and switches to `/api/events?after=<sequence>&transport=poll` after bounded SSE failures.

- [ ] **Step 5: Run event tests**

Run: `node --test --experimental-strip-types tests/project-events.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/api/events/route.ts src/hooks/useProjectEvents.ts src/lib/build-service.ts src/lib/build-execution.ts src/lib/intake/service.ts tests/project-events.test.mjs
git commit -m "feat: stream persisted project events deterministically"
```

### Task 9: Intake, Evidence, Brief, and Approval APIs

**Files:**
- Create all intake/project API route files listed in the File Map.
- Create: `tests/intake-api.integration.test.mjs`
- Modify: `src/app/api/builds/open/route.ts`

**Interfaces:**
- Consumes: `IntakeService`, `IntakeStore`, and file storage.
- Produces: validated JSON/multipart APIs with server-only paths and exact status codes.

- [ ] **Step 1: Write failing API lifecycle tests**

```js
test('API performs compose → analyze → resolve → approve without leaking paths', async () => {
  const project = await postJson('/api/projects', { name: 'Flow', objective: 'Build ordering software' });
  const upload = await postMultipart(`/api/intakes/${project.intakeId}/sources`, pdfFixture);
  assert.equal(JSON.stringify(upload).includes(project.workspace), false);
  await postJson(`/api/intakes/${project.intakeId}/analyze`, {});
  const brief = await getJson(`/api/intakes/${project.intakeId}/brief`);
  assert.equal(brief.visualCoverage.complete, true);
  const approved = await postJson(`/api/intakes/${project.intakeId}/approve`, { briefVersionId: brief.id });
  assert.match(approved.approvalHash, /^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Run and confirm 404/missing-route failures**

Run: `node --test --experimental-strip-types tests/intake-api.integration.test.mjs`  
Expected: FAIL because intake API routes are absent.

- [ ] **Step 3: Implement schemas, responses, and safe source controls**

Use Zod for JSON fields and server-side multipart validation. Page responses require source ownership under the intake and return the derived image with `private, no-store`. Open-folder actions resolve only a registered project/intake directory.

- [ ] **Step 4: Add invalidation behavior**

Replace triggers affected processing and materiality evaluation. Delete creates a tombstone, leaves the brief readable, and marks citations unavailable. Material changes move the project back to `Understanding`/`Awaiting Approval`.

- [ ] **Step 5: Run API integration tests**

Run: `node --test --experimental-strip-types tests/intake-api.integration.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/api/projects src/app/api/intakes src/app/api/builds/open/route.ts tests/intake-api.integration.test.mjs
git commit -m "feat: expose private intake and approval APIs"
```

### Task 10: Precision Liquid Glass Shell and Mode Architecture

**Files:**
- Create: `src/components/builder/ProjectRail.tsx`
- Create: `src/components/builder/SystemHealth.tsx`
- Create: `tests/premium-ui.test.mjs`
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/builder-regression.test.mjs`

**Interfaces:**
- Produces: a project shell that selects `Compose | Understand | Approval | Build` from authoritative project state.
- Consumes: existing health and history APIs plus bundled Fontsource CSS.

- [ ] **Step 1: Write failing UI contract tests**

```js
test('premium shell exposes the four explicit product modes', () => {
  const page = readFileSync('src/app/page.tsx', 'utf8');
  for (const mode of ['Compose', 'Understand', 'Approve & Build', 'Build']) assert.match(page, new RegExp(mode));
});

test('visual system includes restrained glass, bundled type, and reduced motion', () => {
  assert.match(css, /--deep-space:\s*#07111f/i);
  assert.match(css, /backdrop-filter:\s*blur/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /transition:\s*all/);
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `node --test --experimental-strip-types tests/premium-ui.test.mjs`  
Expected: FAIL because the new shell/tokens are absent.

- [ ] **Step 3: Split the page and implement the continuous environment**

Keep `page.tsx` as the data/mode coordinator. Implement the persistent rail, quiet status capsule, main stage, and contextual inspector. Import bundled Sora, Manrope, and IBM Plex Mono. Use pseudo-elements and composited gradients for refraction; glass borders use highlight/shadow pairs rather than repeated card boxes.

- [ ] **Step 4: Implement accessible project-state transitions**

On startup, show `Recovering persisted state` until project, intake, build, and highest event sequence reconcile. Use semantic navigation, headings, `aria-live="polite"` for state changes, and focus placement when the mode changes.

- [ ] **Step 5: Run UI and existing regression tests**

Run: `node --test --experimental-strip-types tests/premium-ui.test.mjs tests/builder-regression.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/page.tsx src/app/layout.tsx src/app/globals.css src/components/builder/ProjectRail.tsx src/components/builder/SystemHealth.tsx tests/premium-ui.test.mjs tests/builder-regression.test.mjs
git commit -m "feat: introduce premium liquid glass project shell"
```

### Task 11: Compose, Source Management, Understanding, and Approval UI

**Files:**
- Create: `src/components/builder/ComposeMode.tsx`
- Create: `src/components/builder/SourceManager.tsx`
- Create: `src/components/builder/UnderstandMode.tsx`
- Create: `src/components/builder/EvidenceViewer.tsx`
- Create: `src/components/builder/ApprovalMode.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/premium-ui.test.mjs`

**Interfaces:**
- Consumes: Task 9 APIs and project state.
- Produces: drag/drop and picker intake, progress by source/page, source controls, cited brief, conflict resolution, and one approval action.

- [ ] **Step 1: Add failing component contract tests**

```js
test('compose accepts all approved local source types', () => {
  assert.match(compose, /\.pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp/);
  assert.match(compose, /drop/i);
});

test('approval is disabled for unresolved conflicts or incomplete visual coverage', () => {
  assert.match(approval, /unresolvedDecisions\.length\s*>\s*0/);
  assert.match(approval, /!brief\.visualCoverage\.complete/);
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `node --test --experimental-strip-types tests/premium-ui.test.mjs`  
Expected: FAIL for missing components.

- [ ] **Step 3: Implement Compose and SourceManager**

Stream uploads with progress. Render source revision, pages inspected, OCR use, local-only state, and exact failure guidance. View opens the source/evidence viewer; Open folder calls the safe server action; Replace preserves lineage; Delete requires a scoped confirmation naming one source.

- [ ] **Step 4: Implement Understanding and evidence citations**

Render brief sections as readable document structure, not equal-weight cards. Citation controls load exact page images and position an accessible SVG/HTML overlay from normalized region coordinates. Unavailable tombstoned evidence remains labeled.

- [ ] **Step 5: Implement conflict resolution and approval**

Required conflicts present only the conflicting evidence and an answer control. Approval mode summarizes contract inputs and posts the exact brief version. The primary button remains disabled until coverage and decisions pass server and client validation.

- [ ] **Step 6: Run UI tests**

Run: `node --test --experimental-strip-types tests/premium-ui.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/app/page.tsx src/app/globals.css src/components/builder/ComposeMode.tsx src/components/builder/SourceManager.tsx src/components/builder/UnderstandMode.tsx src/components/builder/EvidenceViewer.tsx src/components/builder/ApprovalMode.tsx tests/premium-ui.test.mjs
git commit -m "feat: add source-grounded approval experience"
```

### Task 12: Live Build Workspace and Living Build Spine

**Files:**
- Create: `src/components/builder/BuildMode.tsx`
- Create: `src/components/builder/LivingBuildSpine.tsx`
- Create: `src/components/builder/EventStream.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/premium-ui.test.mjs`
- Modify: `tests/project-events.test.mjs`

**Interfaces:**
- Consumes: `useProjectEvents`, build APIs, persisted `ProjectEvent[]`, and verification checks.
- Produces: real stage projection, repair branches, human/technical layers, build controls, and restart reconstruction.

- [ ] **Step 1: Write failing state/projection UI tests**

```js
test('living spine renders repair, blocked, recovered, and complete from events', () => {
  for (const state of ['repair', 'blocked', 'recovered', 'complete']) {
    assert.match(spine, new RegExp(`spine-${state}`));
  }
  assert.doesNotMatch(spine, /Math\.random|fakeProgress|estimatedPercent/);
});

test('restart mode waits for reconciliation before animating', () => {
  assert.match(buildMode, /Recovering persisted state/);
  assert.match(buildMode, /reconciled\s*&&/);
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `node --test --experimental-strip-types tests/premium-ui.test.mjs tests/project-events.test.mjs`  
Expected: FAIL for missing BuildMode/spine.

- [ ] **Step 3: Implement event-derived spine**

Project ordered events into named stages: resource discovery, workspace, implementation, tests, repair, certification, launch. Compute only completed/current/not-started states and `completed stages / applicable stages`; label it as stage count, not a predicted percentage.

- [ ] **Step 4: Implement human and technical streams**

Human view uses `humanMessage`, stage, and relative time. Technical view displays target, source, job/tool IDs, attempt, severity, and redacted payload. Both use the same sequence and expose no source contents by default.

- [ ] **Step 5: Preserve controls and verification**

Carry forward Resume, Cancel, View logs, Open project, Open finished app, and Rerun verification. Show Pause only when the status response explicitly advertises pause support.

- [ ] **Step 6: Run UI/event tests**

Run: `node --test --experimental-strip-types tests/premium-ui.test.mjs tests/project-events.test.mjs tests/builder-regression.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/app/page.tsx src/app/globals.css src/components/builder/BuildMode.tsx src/components/builder/LivingBuildSpine.tsx src/components/builder/EventStream.tsx tests/premium-ui.test.mjs tests/project-events.test.mjs tests/builder-regression.test.mjs
git commit -m "feat: visualize persisted autonomous execution"
```

### Task 13: Desktop Worker Packaging and Local Capability Startup

**Files:**
- Modify: `desktop/runtime.mjs`
- Modify: `desktop/main.mjs`
- Modify: `desktop-builder.yml`
- Modify: `scripts/prepare-desktop.mjs`
- Modify: `scripts/start-builder.ps1`
- Modify: `package.json`
- Modify: `tests/desktop-contract.test.mjs`
- Modify: `tests/launcher.test.mjs`

**Interfaces:**
- Consumes: `dist-worker/intake-worker.mjs`, local Ollama configuration, existing secure server environment discovery.
- Produces: installed desktop server env `BUILDER_INTAKE_WORKER`, packaged worker artifact, and no leaked models/evidence/state.

- [ ] **Step 1: Write failing package contract tests**

```js
test('desktop package includes worker but excludes intake data and models', () => {
  const config = loadDesktopBuilderConfig(configPath);
  assert.equal(config.extraResources.some((item) => item.to === 'builder-worker'), true);
  assert.equal(config.files.some((item) => item.includes('intake/originals')), false);
});

test('server launch passes worker path only through server environment', () => {
  const launch = buildServerLaunch(runtimeFixture({ intakeWorker: 'C:\\safe\\intake-worker.mjs' }));
  assert.equal(launch.args.join(' ').includes('intake-worker'), false);
  assert.equal(launch.env.BUILDER_INTAKE_WORKER, 'C:\\safe\\intake-worker.mjs');
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `npm run desktop:test`  
Expected: FAIL on missing builder-worker package/env behavior.

- [ ] **Step 3: Package worker and configure production paths**

Run `npm run intake:worker:build` before desktop preparation. Add `dist-worker/intake-worker.mjs` as `builder-worker/intake-worker.mjs`. Resolve writable intake state under project workspaces and worker code under read-only resources. Do not package Ollama models; capability recovery uses the local user installation/model store.

- [ ] **Step 4: Extend package validation**

Reject originals, derived evidence, approval databases, `.ollama`, model blobs, `.env*`, cookies, logs, and SQLite files anywhere in packaged resources.

- [ ] **Step 5: Run desktop tests and package preparation**

Ensure the scheduled local launcher builds `dist-worker/intake-worker.mjs` when missing and exports `BUILDER_INTAKE_WORKER` server-side before starting the supervisor.

Run: `npm run desktop:test && node --test tests/launcher.test.mjs && npm run build && npm run intake:worker:build && npm run desktop:prepare`  
Expected: PASS and validator reports zero forbidden files.

- [ ] **Step 6: Commit**

```powershell
git add desktop/runtime.mjs desktop/main.mjs desktop-builder.yml scripts/prepare-desktop.mjs scripts/start-builder.ps1 package.json tests/desktop-contract.test.mjs tests/launcher.test.mjs
git commit -m "build: package private multimodal intake worker"
```

### Task 14: Real Document Fixtures and Automated Desktop E2E

**Files:**
- Create: `tests/fixtures/create-intake-fixtures.mjs`
- Create: `tests/e2e/premium-builder.spec.mjs`
- Create generated fixtures under: `tests/fixtures/intake/`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: installed/local Builder APIs and Electron shell.
- Produces: reproducible PDF/DOCX fixtures and a real UI acceptance test.

- [ ] **Step 1: Add Playwright test runner**

Run: `npm install --save-dev --save-exact @playwright/test@1.62.1 pdf-lib@1.17.1 docx@9.7.1`  
Expected: Playwright runner is pinned; install Chromium only if the existing browser cache lacks the required revision.

- [ ] **Step 2: Generate deterministic multimodal fixtures**

The generator must create:

- `ui-requirements.pdf`: selectable text plus an embedded checkout UI screenshot.
- `scanned-requirements.pdf`: raster-only pages containing readable requirements.
- `restaurant-flow.pdf`: a flowchart with nodes/edges that imply application logic.
- `product-brief.docx`: paragraphs, a requirements table, and an embedded wireframe.
- `conflict-brief.pdf`: text and a diagram that intentionally disagree about checkout order.

Run: `node tests/fixtures/create-intake-fixtures.mjs`  
Expected: fixture files are deterministic and contain no private/user data.

- [ ] **Step 3: Write the failing full UI flow**

```js
test('multimodal project proceeds only through approved understanding', async ({ page }) => {
  await page.goto('http://127.0.0.1:3107');
  await page.getByLabel('Finished outcome').fill('Build the restaurant ordering application described by the evidence.');
  await page.getByLabel('Project evidence').setInputFiles('tests/fixtures/intake/conflict-brief.pdf');
  await page.getByRole('button', { name: 'Understand project' }).click();
  await expect(page.getByText('Visual inspection complete')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & build' })).toBeDisabled();
  await page.getByLabel('Resolve checkout order').fill('Payment happens after confirmation.');
  await page.getByRole('button', { name: 'Apply decision' }).click();
  await page.getByRole('button', { name: 'Approve & build' }).click();
  await expect(page.getByText('Living Build Spine')).toBeVisible();
});
```

- [ ] **Step 4: Run E2E and fix only product defects**

Run: `npx playwright test tests/e2e/premium-builder.spec.mjs --project=chromium`  
Expected: PASS through real APIs and persisted state; no route interception or mocked build responses.

- [ ] **Step 5: Add visual/accessibility assertions**

Test 1440×960 and 1080×720 viewports, keyboard traversal, visible focus, reduced motion, quiet healthy state, expanded degraded state, region highlight, and zero fatal console errors.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json .gitignore tests/fixtures/create-intake-fixtures.mjs tests/fixtures/intake tests/e2e/premium-builder.spec.mjs
git commit -m "test: cover multimodal desktop builder end to end"
```

### Task 15: Production Regression, Self-Healing, Restart Recovery, and Installer Acceptance

**Files:**
- Modify only files implicated by observed failures.
- Record acceptance evidence in the existing SQLite build/event history and test output; do not add temporary request files.

**Interfaces:**
- Validates the complete system from installed desktop UI through finished local application.

- [ ] **Step 1: Run the full repository pipeline**

Run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run intake:worker:build
npm run desktop:test
```

Expected: every command exits `0`; test summary contains no failures, skips without applicability reasons, or unhandled rejections.

- [ ] **Step 2: Run real multimodal intake acceptance**

Start the production Builder and use `restaurant-flow.pdf` plus `product-brief.docx`. Verify every page has persisted visual evidence, citations open exact pages, and the generated brief contains flow relationships and embedded visual requirements.

- [ ] **Step 3: Run controlled conflict and approval integrity acceptance**

Use `conflict-brief.pdf`, resolve the contradiction, approve, then attempt a material source replacement. Verify the old approval becomes invalid and build start rejects its hash. Rename a source without changing content and verify approval remains valid.

- [ ] **Step 4: Run self-healing acceptance**

Stop Ollama during a controlled page inspection. Verify classification, persisted capability-recovery events, service restart/repair, page retry, completed visual coverage, and intake continuation. During the generated application build, inject one deterministic test/build failure and verify an amber repair branch reconnects only after the repaired gate passes.

- [ ] **Step 5: Run restart recovery acceptance**

Interrupt the Builder during multi-page intake, restart it, and verify resume from the first incomplete page. Interrupt/restart during build, verify Computer 2 `job_resume`, deterministic event replay, no duplicate sequences, accurate spine reconstruction, and eventual completion.

- [ ] **Step 6: Build and install the release**

Run:

```powershell
npm run desktop:installer
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop.ps1 -OutputDirectory dist-desktop -Silent
```

Expected: one NSIS installer is created and the installed app/shortcuts are updated.

- [ ] **Step 7: Launch from the actual desktop shortcut**

Verify one responsive native window, `http://127.0.0.1:3107/` loaded inside Electron, no external browser opened, 12+ historical builds retained, new intake/brief/history retained after close/reopen, and second launch focuses the existing window.

- [ ] **Step 8: Audit packaged resources and live health**

Verify zero `.env*`, cookies, originals, derived evidence, project databases, logs, model blobs, or known secret-value matches under installed resources. Record Computer 2, Docker MCP, authenticated Chrome, Windmill, local vision, Builder runtime, installer signature, installer hash, installed executable path, Builder URL, generated project path, and generated app URL.

- [ ] **Step 9: Run final verification once more after installation fixes**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run desktop:test`  
Expected: all gates pass on the exact committed tree used for the installer.

- [ ] **Step 10: Commit any evidence-driven fixes and confirm a clean tree**

```powershell
git status --short
git log --oneline -20
```

Expected: no uncommitted source changes or untracked production artifacts.
