# Premium Multimodal Autonomous Builder Design

**Status:** Approved design  
**Date:** 2026-08-13  
**Product:** Autonomous Project Builder desktop application

## 1. Outcome

Upgrade the installed private Autonomous Project Builder into a polished, production-grade desktop experience that accepts text and local documents, understands all meaningful textual and visual evidence, produces a source-grounded Build Brief, requires one explicit approval, and then executes autonomously with accurate live progress.

The product promise is:

> You describe it → it understands it → you approve it once → it gets the work done.

This work preserves the existing hybrid architecture, Computer 2 MCP, durable job runner, error classification, authenticated Chrome bridge, Docker MCP gateway, Windmill integration, SQLite build state, Electron desktop shell, and local-first runtime.

## 2. Governing Principles

1. An approved Build Brief is an immutable execution contract.
2. Textual and visual evidence are equal first-class inputs.
3. Every PDF page is inspected visually, including pages with selectable text.
4. OCR is conditional and supplements native extraction for scanned or non-machine-readable regions.
5. Original sources remain private and local unless the user explicitly authorizes a source-specific external analysis step.
6. The database is authoritative. The UI and SSE stream only project persisted reality.
7. Progress is evidence-based. The Builder never invents percentages, stages, repairs, or completion.
8. One approval starts autonomous execution. Routine implementation decisions and recoverable failures do not return to the user.

## 3. Scope

### Included

- Premium Precision Liquid Glass desktop interface.
- Compose, Understand, Approve & Build, and Build modes.
- Text input and multi-file local intake.
- PDF, DOC, DOCX, TXT, Markdown, PNG, JPEG, and WebP sources.
- Text extraction, fixed-layout rendering, conditional OCR, and local visual understanding.
- Page- and region-level source citations.
- Versioned Build Briefs, decisions, conflicts, and approval contracts.
- Immutable build-to-brief linkage.
- Ordered persisted events with SSE replay and polling fallback.
- Living Build Spine based on real execution, repair, and verification events.
- Restart recovery for intake, approval, build progress, and history.
- Updated Electron package and Windows installer.
- Full automated regression and real desktop end-to-end acceptance.

### Not included

- Replacing Computer 2 MCP or its job runner.
- Replacing authenticated Chrome with an unauthenticated browser.
- Making Docker MCP, Windmill, GitHub, or Vercel mandatory for local builds.
- Cloud storage of intake documents.
- A separate competing workflow or retry engine.
- Fabricated progress estimates.

## 4. User Experience Architecture

### 4.1 Compose

The user describes the finished outcome and supplies evidence. The primary surface contains a generous outcome editor and a drag-and-drop document well.

Each source shows:

- Original filename and normalized local filename.
- Type, size, page count, and revision.
- Upload, extraction, rendering, OCR, and visual-inspection state.
- Local-only privacy state.
- View, Open folder, Replace, and Delete controls.

The Builder creates the project and private workspace during intake rather than waiting until execution.

### 4.2 Understand

The Builder presents a source-grounded Build Brief containing:

- Intended outcome.
- Users and roles.
- User flows and application logic.
- Functional and non-functional requirements.
- Visual/design direction.
- Data, authentication, APIs, services, and integrations.
- Local/runtime/deployment expectations.
- Explicit exclusions.
- Acceptance tests and production gates.
- Assumptions.
- Conflicts, uncertainty, and required decisions.

Every material claim links to its evidence. Citations identify the source, page, evidence type, and relevant region where coordinates are available. Selecting a visual citation opens the exact rendered page and highlights the screenshot, diagram, table, annotation, or other cited region.

Approval remains unavailable while a mandatory page lacks visual coverage or a required conflict/decision is unresolved.

### 4.3 Approve & Build

This is a first-class mode and the universal pre-build gate.

The approval screen clearly presents:

- Final brief version.
- Source manifest version.
- Resolved decisions.
- Relevant build configuration.
- Remaining non-blocking warnings.
- Local privacy and execution targets.

One **Approve & build** action writes the approval contract and begins autonomous execution. After approval, the existing continuation policy applies.

### 4.4 Build

The user observes real implementation, recovery, verification, and launch without supervising routine work.

Two synchronized progress layers are available:

- A human-readable narrative describing what is happening, what changed, and why.
- An expandable technical stream showing targets, tools, commands, attempts, repairs, diagnostics, checkpoints, and results.

Pause appears only when supported by the underlying runner. Resume, Cancel, View logs, Open project, Open finished app, and Rerun verification retain real server-backed behavior.

## 5. Visual Direction: Precision Liquid Glass

The interface is one continuous architectural environment. Glass establishes hierarchy and depth rather than decorating a conventional dashboard with translucent rectangles.

### 5.1 Tokens

- Deep space: `#07111F`
- Blue-black: `#0B1728`
- Frost: `#F4F8FF`
- Electric iris: `#8C82FF`
- Signal aqua: `#61E8D4`
- Recovery amber: `#F4BC6A`

Typography is bundled for offline desktop use:

- Sora for display and major stage labels.
- Manrope for interface copy.
- IBM Plex Mono for identifiers, tools, paths, and diagnostics.

### 5.2 Signature Interaction: Living Build Spine

The Living Build Spine visualizes execution only:

- Normal execution: continuous illuminated spine.
- Active work: restrained pulse at the current persisted stage.
- Repair: amber branch leaves the spine, records the repair, then reconnects after recovery.
- Blocked: visibly interrupted segment awaiting a genuine dependency.
- Recovered: the branch rejoins and execution continues.
- Complete: verification closes the path and connects to the launched result.

Project/build state is displayed separately from execution:

```text
Draft
  ↓
Understanding
  ↓
Awaiting Approval
  ↓
Approved
  ↓
Building ──────────────→ Complete
   │                       ↑
   ├→ Blocked → Building ──┘
   │
   ├────────────────────→ Failed
   │
   └────────────────────→ Cancelled
```

`Blocked` means execution can continue once a genuine external or user-only dependency is resolved. `Failed` means execution terminated after the permitted recovery policy was exhausted.

### 5.3 Motion and Accessibility

- Slow ambient refraction on GPU-friendly composited layers.
- Subtle depth shifts for active surfaces.
- Staggered brief-section reveal after persisted analysis completes.
- Stage connectors animate only when state advances.
- Repair branches animate only from recorded repair events.
- No replayed completion animation during restart recovery.
- Full `prefers-reduced-motion` behavior.
- Contrast-safe glass, visible focus, complete keyboard access, and responsive layouts.
- Healthy system state collapses to a quiet indicator. Degraded state expands contextually.

## 6. Local Storage Layout

Each project owns its intake data:

```text
project/
  intake/
    originals/
    derived/
    briefs/
    evidence/
```

- `originals/` contains retained source revisions.
- `derived/` contains rendered pages and locally generated processing artifacts.
- `briefs/` contains readable snapshots of versioned briefs.
- `evidence/` contains exportable source-grounding artifacts.

SQLite, not loose files, is authoritative for manifests, state, relationships, approvals, and events. Files are content-addressed or identified through immutable database IDs.

## 7. Data Model

### 7.1 Projects and Intakes

Persist project identity, workspace, current mode/state, active intake, approved brief, active build, timestamps, and revision counters.

Intake states include `draft`, `queued`, `extracting`, `rendering`, `inspecting`, `synthesizing`, `awaiting_resolution`, `awaiting_approval`, `approved`, `invalidated`, `blocked`, and `failed`.

### 7.2 Immutable Source Manifest

Every source revision records:

- Immutable source ID.
- Project and intake IDs.
- Content hash.
- MIME type and detected format.
- Original and normalized filenames.
- Size.
- Ingestion timestamp.
- Revision and replacement lineage.
- Processing and availability status.
- Page/region coverage counts.
- Local path stored only server-side.

Renaming harmless display metadata does not change source identity. Replacing content creates a new revision.

Deleting an original tombstones its manifest entry, preserves the approved brief, and marks citations as unavailable. It does not rewrite history.

### 7.3 Evidence

Evidence records include source ID/revision, page, region coordinates when known, evidence type, extracted content or local artifact reference, confidence, processing method, and relationships to brief claims.

Evidence types include native text, OCR text, page overview, embedded visual, screenshot/UI, diagram/flow, table/chart, annotation, layout, and user-provided text.

### 7.4 Briefs and Decisions

Brief versions are immutable after creation. A new synthesis produces Revision N+1. Decisions and conflict resolutions are versioned and source-linked.

### 7.5 Approval Contract

Approval is a deterministic hash of:

```text
brief version
+ source manifest content identities
+ resolved decisions
+ relevant build configuration
```

Relevant configuration includes repository/workspace choice, backend/integration selections, execution/deployment target, workflow requirements, authenticated-browser need, and host requirements.

Only material scope changes invalidate approval. Content changes, changed decisions, changed requirements, or relevant configuration changes are material. Display-name changes, harmless metadata corrections, or timestamps are not.

A build cannot start unless it references the current approved contract and all hashed material still matches.

Once execution starts, revisions never mutate the active contract. Document or requirement changes create Revision N+1 for a future build.

## 8. Durable Multimodal Intake Pipeline

The document worker is submitted through the existing Computer 2 durable job runner and checkpoints after each meaningful unit of work.

Pipeline:

```text
Source validation
→ native text/structure extraction
→ fixed-layout conversion where needed
→ render every page
→ inspect every page visually
→ conditional OCR for scans/non-readable regions
→ detect and interpret meaningful visuals
→ normalize page/region evidence
→ merge textual and visual findings
→ detect contradictions and uncertainty
→ synthesize versioned Build Brief
```

PDF pages are always visually inspected. DOC and DOCX use local Microsoft Word conversion when available so pagination, tables, embedded images, and layout are preserved, with a safe local converter as a recoverable alternative.

### 8.1 Capability Recovery

When required local visual capability is unavailable, the Builder performs this order:

1. Discover existing compatible resources and models.
2. Start stopped services.
3. Repair configuration, paths, or connectivity.
4. Restart unhealthy local services.
5. Provision an approved compatible local capability when necessary.
6. Health-check it and resume the persisted intake job.

The Builder diagnoses before installing. Model installation is one recovery option, not the default assumption.

If local recovery is exhausted, the source remains blocked. External analysis is never automatic; it requires explicit per-source authorization that names what content will leave the machine and why.

## 9. Persisted Live Event Model

The database is authoritative. SSE transports persisted changes to the UI; it never owns history.

Every event contains:

```text
sequence
event_id
project_id
build_id
job_id
timestamp
category
stage
severity
source
human_message
technical_payload
```

`sequence` is monotonically increasing within the project event stream. Event IDs are unique and replayable. The endpoint supports `Last-Event-ID`; reconnection deterministically replays missing events without duplicates or reordering. Polling remains the fallback transport.

Event sources include Computer 2 job status, structured worker output, tool/target changes, checkpoints, repairs, tests, verification, runtime boot, and HTTP validation. All technical payloads pass existing secret redaction before persistence.

The human timeline is derived from the same persisted events as the technical stream. The Living Build Spine is a projection of those events and never the source of state.

## 10. Restart and Recovery

On Builder or Computer 2 restart:

1. Load authoritative projects, intakes, briefs, approvals, builds, and events.
2. Discover interrupted Computer 2 jobs.
3. Resume recoverable intake/build jobs through existing recovery mechanisms.
4. Query the real remote job state.
5. Reconstruct project state and the Living Build Spine from persisted checkpoints/events.
6. Resume SSE from the last acknowledged event sequence.

The UI shows `Recovering persisted state` until reconciliation finishes. It does not animate unverified work.

## 11. API and Component Boundaries

Server APIs will cover:

- Project/intake creation and retrieval.
- Streaming source upload.
- Source view/open-folder/replace/delete.
- Intake analyze, status, and resume.
- Brief retrieval, decisions, and conflict resolution.
- Approval creation and validation.
- Build start from an approval contract.
- Ordered event replay/streaming.
- Existing build controls and health.

Large UI responsibilities will be split into focused components rather than expanding the current page monolith:

- Project shell and navigation.
- Compose workspace.
- Source/evidence manager.
- Understanding/brief review.
- Approval contract view.
- Build workspace and Living Build Spine.
- Human activity and technical event streams.
- Verification matrix.
- Contextual health indicator.
- Project/build history.

## 12. Error Handling

- Corrupt or unsupported source: identify the exact source and replacement action.
- Conversion failure: repair/restart local conversion or provision a safe local converter.
- OCR/vision unavailable: run capability recovery, health-check, and resume.
- Page inspection failure: retry the page; approval stays blocked until complete coverage.
- Conflicting evidence: persist a required resolution linked to both sources.
- Low confidence: surface the interpretation and precise evidence.
- Intake interruption: resume from the last document/page checkpoint.
- Source replacement: regenerate affected evidence/brief sections and evaluate materiality.
- SSE interruption: replay from persisted sequence, then fall back to polling.
- Build repair: branch and reconnect the spine only from recorded repair events.

## 13. Security and Privacy

- Uploads stream to local disk and remain server-side.
- Filenames, extensions, MIME signatures, paths, sizes, and counts are validated.
- Browser responses never reveal arbitrary absolute paths.
- Originals, thumbnails, extracted text, and evidence never enter frontend bundles or ordinary logs.
- Tokens, cookies, passwords, authorization headers, and secrets use existing redaction.
- Originals and derived evidence remain under the private local project workspace.
- Local capability discovery occurs before requesting or provisioning anything.
- External document analysis is disabled by default and source-specific when authorized.
- Approval hashes prevent silent source, decision, or configuration changes.
- Desktop packaging excludes local projects, originals, evidence, models, databases, logs, and secrets.

## 14. Testing and Acceptance

### Automated unit and integration coverage

- Source/path/MIME validation and streaming limits.
- Manifest identity, replacement lineage, and tombstones.
- Native text plus conditional OCR behavior.
- Page-level visual coverage enforcement.
- Evidence merge and text/visual conflict detection.
- Brief versioning and material-change rules.
- Approval contract hashing and stale-contract rejection.
- Source deletion and replacement behavior.
- Ordered event persistence, replay, deduplication, and polling fallback.
- Human event translation and spine projection.
- Blocked, recovered, failed, cancelled, and complete transitions.
- Capability discovery/repair/provision/resume.
- Optional Docker/Windmill outages remain non-blocking when irrelevant.
- Builder and Computer 2 restart recovery.

### Document fixtures

- Text-only project request.
- PDF with selectable text and an embedded UI screenshot.
- Fully scanned PDF with no selectable text.
- PDF flowchart whose relationships define application logic.
- Word document with text, tables, and embedded images.
- Contradictory text and visual evidence.

### Production acceptance

Run through the installed desktop application:

```text
Compose
→ attach a multimodal PDF/Word source
→ understand every page
→ review citations and visual highlights
→ resolve a controlled contradiction
→ Approve & build
→ observe persisted live events and Living Build Spine
→ inject and recover from a controlled failure
→ complete all verification gates
→ launch the finished local application
→ restart Builder
→ restore project, brief, history, and spine accurately
```

Final verification must include lint, typecheck, unit tests, integration tests, production build, document E2E, real Electron flow, self-healing, restart recovery, installer rebuild/install, shortcut launch, package secret audit, accessibility checks, reduced-motion checks, and visual inspection at desktop and constrained viewport sizes.

## 15. Completion Standard

This upgrade is complete only when the installed desktop application can accept a real multimodal document, build a fully source-grounded and visually informed brief, enforce approval integrity, autonomously execute the approved contract, accurately stream real progress, recover from a controlled failure and restart, pass the production gate, and launch the finished local application.

