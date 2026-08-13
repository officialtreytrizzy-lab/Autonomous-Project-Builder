# Autonomous Project Builder Desktop Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an installable Windows desktop application that opens the existing private Autonomous Project Builder in a secure native window and preserves its local service, build history, and Computer 2 integrations.

**Architecture:** Add a thin Electron main process around the existing Next.js Builder. Electron reuses a compatible Builder on port 3107 or starts the packaged Next standalone server with server-only configuration, while Electron Builder packages both layers into an NSIS installer.

**Tech Stack:** Electron, Electron Builder, NSIS, Next.js standalone output, Node test runner, PowerShell, Windows Scheduled Tasks, SQLite

**Spec:** `docs/superpowers/specs/2026-08-13-desktop-app-design.md`

## Global Constraints

- The product remains private and local-first; GitHub and Vercel are optional project destinations, never Builder dependencies.
- The default Builder origin is exactly `http://127.0.0.1:3107` unless `BUILDER_PORT` overrides it.
- Port 3000 remains reserved for Computer 2 MCP.
- MCP, Docker gateway, Windmill, cookie, and service tokens remain outside renderer JavaScript, preload APIs, logs, installer metadata, and packaged static files.
- The renderer uses `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- The installer creates Start Menu and desktop shortcuts named **Autonomous Project Builder**.
- Authoritative SQLite state and generated project workspaces live outside the versioned installation directory.
- Existing authenticated Chrome, Computer 2 MCP, Docker, Windmill, generated application, and job-runner processes are not replaced or stopped.
- Every production behavior follows red-green-refactor test-driven development.

## File Map

- `desktop/runtime.mjs`: pure desktop configuration, environment, path, health, restart, and navigation decisions.
- `desktop/main.mjs`: Electron application lifecycle, server process ownership, native window, and single-instance behavior.
- `desktop/startup.html`: local native startup/recovery screen shown before the Builder is ready.
- `desktop-builder.yml`: Electron Builder and NSIS packaging contract.
- `scripts/prepare-desktop.mjs`: validates and stages Next standalone resources before packaging.
- `scripts/install-desktop.ps1`: launches the generated NSIS installer with an explicit validated path.
- `tests/desktop-runtime.test.mjs`: pure lifecycle and security behavior tests.
- `tests/desktop-contract.test.mjs`: packaging, Electron security, scripts, and shortcut contract tests.
- `next.config.ts`: enables standalone server output.
- `package.json`: Electron dependencies and desktop commands.
- `.gitignore`: excludes packaged output and desktop runtime artifacts.

---

### Task 1: Pure Desktop Runtime Contract

**Files:**
- Create: `desktop/runtime.mjs`
- Create: `tests/desktop-runtime.test.mjs`

**Interfaces:**
- Produces: `parseAllowedEnvironment(text: string): Record<string,string>`
- Produces: `classifyBuilderHealth(payload: unknown): 'compatible' | 'incompatible'`
- Produces: `desktopOrigin(port?: number): string`
- Produces: `resolveDesktopPaths(input): DesktopPaths`
- Produces: `isAllowedRendererNavigation(url: string, origin: string): boolean`
- Produces: `restartDelay(attempt: number): number | null`

- [ ] **Step 1: Write failing runtime tests**

```js
test('environment parsing imports only server allow-list keys', () => {
  const parsed = parseAllowedEnvironment('MCP_AUTH_TOKEN=secret\nNEXT_PUBLIC_TOKEN=leak\nWINDMILL_URL=http://127.0.0.1');
  assert.deepEqual(parsed, { MCP_AUTH_TOKEN: 'secret', WINDMILL_URL: 'http://127.0.0.1' });
});

test('renderer navigation is restricted to the exact Builder origin', () => {
  assert.equal(isAllowedRendererNavigation('http://127.0.0.1:3107/build', 'http://127.0.0.1:3107'), true);
  assert.equal(isAllowedRendererNavigation('https://example.com', 'http://127.0.0.1:3107'), false);
});

test('restart delay stops after five bounded attempts', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(restartDelay), [500, 1000, 2000, 4000, 8000, null]);
});
```

- [ ] **Step 2: Run the runtime tests and verify RED**

Run: `node --test tests/desktop-runtime.test.mjs`

Expected: FAIL because `desktop/runtime.mjs` does not exist.

- [ ] **Step 3: Implement the pure runtime functions**

```js
const ALLOWED_ENVIRONMENT = new Set([
  'MCP_AUTH_TOKEN', 'BUILDER_SERVICE_TOKEN', 'MCP_MAIN_NODE_URL', 'COMPUTER2_MCP_URL',
  'COMPUTER2_HEALTH_URL', 'DOCKER_MCP_GATEWAY_TOKEN', 'DOCKER_MCP_GATEWAY_HEALTH_URL',
  'MCP_GATEWAY_AUTH_TOKEN', 'WINDMILL_URL', 'BUILDER_PROJECTS_ROOT', 'BUILDER_STATE_DB',
]);

export function restartDelay(attempt) {
  return attempt >= 5 ? null : Math.min(8000, 500 * (2 ** attempt));
}
```

Implement the other exported functions with URL parsing, exact-origin comparison, quoted environment-value handling, port validation from 1 through 65535, and packaged versus development path inputs.

- [ ] **Step 4: Run the runtime tests and verify GREEN**

Run: `node --test tests/desktop-runtime.test.mjs`

Expected: all desktop runtime tests PASS.

- [ ] **Step 5: Commit the runtime contract**

```powershell
git add desktop/runtime.mjs tests/desktop-runtime.test.mjs
git commit -m "feat: add secure desktop runtime contract"
```

---

### Task 2: Electron Main Process and Native Window

**Files:**
- Create: `desktop/main.mjs`
- Create: `desktop/startup.html`
- Create: `tests/desktop-contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: all exports from `desktop/runtime.mjs`
- Produces: Electron main entry at `desktop/main.mjs`
- Produces: `npm run desktop:dev`
- Produces: native Builder window at the configured local origin

- [ ] **Step 1: Write failing Electron security and lifecycle contract tests**

```js
test('desktop window disables renderer privileges', () => {
  const source = readFileSync('desktop/main.mjs', 'utf8');
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /sandbox:\s*true/);
  assert.doesNotMatch(source, /preload\s*:/);
});

test('desktop uses a single-instance lock and bounded local startup', () => {
  const source = readFileSync('desktop/main.mjs', 'utf8');
  assert.match(source, /requestSingleInstanceLock/);
  assert.match(source, /waitForCompatibleBuilder/);
  assert.match(source, /restartDelay/);
});
```

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `node --test tests/desktop-contract.test.mjs`

Expected: FAIL because the Electron main entry does not exist.

- [ ] **Step 3: Install desktop development dependencies**

Run: `npm install --save-dev electron electron-builder`

Expected: `package.json` and `package-lock.json` contain Electron and Electron Builder without changing application runtime dependencies.

- [ ] **Step 4: Implement Electron lifecycle**

```js
const window = new BrowserWindow({
  width: 1440,
  height: 960,
  minWidth: 1040,
  minHeight: 720,
  show: false,
  webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
});
```

Implement single-instance focus, compatible health detection, Computer 2 root discovery, allow-listed environment import, external-or-owned server selection, bounded owned-server restart, startup error display, exact-origin navigation policy, and shutdown of only the owned Builder child.

- [ ] **Step 5: Add the startup document and development command**

Add a self-contained local HTML startup page without remote assets. Add `"main": "desktop/main.mjs"` and `"desktop:dev": "electron ."` to `package.json`.

- [ ] **Step 6: Run Electron contract and runtime tests**

Run: `node --test tests/desktop-runtime.test.mjs tests/desktop-contract.test.mjs`

Expected: all desktop tests PASS.

- [ ] **Step 7: Commit the desktop shell**

```powershell
git add desktop package.json package-lock.json tests/desktop-contract.test.mjs
git commit -m "feat: open Builder in secure desktop shell"
```

---

### Task 3: Standalone Server and Packaging Contract

**Files:**
- Create: `desktop-builder.yml`
- Create: `scripts/prepare-desktop.mjs`
- Modify: `next.config.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `tests/desktop-contract.test.mjs`

**Interfaces:**
- Consumes: Next standalone output at `.next/standalone/server.js`
- Produces: `npm run desktop:prepare`
- Produces: `npm run desktop:package`
- Produces: `npm run desktop:installer`
- Produces: packaged server at `resources/builder/server.js`

- [ ] **Step 1: Add failing packaging tests**

```js
test('desktop packaging creates NSIS desktop and Start Menu shortcuts', () => {
  const config = readFileSync('desktop-builder.yml', 'utf8');
  assert.match(config, /target:\s*nsis/);
  assert.match(config, /createDesktopShortcut:\s*true/);
  assert.match(config, /createStartMenuShortcut:\s*true/);
  assert.match(config, /artifactName:.*Setup/);
});

test('Next produces a standalone server for the desktop bundle', () => {
  assert.match(readFileSync('next.config.ts', 'utf8'), /output:\s*["']standalone["']/);
});
```

- [ ] **Step 2: Run packaging contract tests and verify RED**

Run: `node --test tests/desktop-contract.test.mjs`

Expected: FAIL because standalone output and `desktop-builder.yml` are absent.

- [ ] **Step 3: Enable standalone output and implement staging validation**

Set `output: 'standalone'` in `next.config.ts`. Implement `scripts/prepare-desktop.mjs` to assert the existence of `.next/standalone/server.js`, copy `.next/static` into `.next/standalone/.next/static`, copy `public` when present, and reject any staged `.env`, SQLite, log, cookie, or token file.

- [ ] **Step 4: Add Electron Builder configuration**

```yaml
appId: com.trizzy.autonomous-project-builder
productName: Autonomous Project Builder
directories:
  output: dist-desktop
files:
  - desktop/**/*
  - package.json
extraResources:
  - from: .next/standalone
    to: builder
win:
  target: nsis
nsis:
  oneClick: false
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Autonomous Project Builder
```

Set an explicit artifact name and per-user installation. Exclude `.builder`, generated projects, logs, test artifacts, environment files, and `.vercel` state.

- [ ] **Step 5: Add packaging commands and ignore rules**

Add scripts that run the Next production build, staging validator, Electron directory package, and NSIS installer. Ignore `dist-desktop/` and desktop packaging scratch output.

- [ ] **Step 6: Run packaging contract tests and build standalone output**

Run: `node --test tests/desktop-contract.test.mjs`

Run: `npm run build && npm run desktop:prepare`

Expected: tests PASS and `.next/standalone/server.js` exists with static assets staged.

- [ ] **Step 7: Commit the packaging contract**

```powershell
git add desktop-builder.yml scripts/prepare-desktop.mjs next.config.ts package.json package-lock.json .gitignore tests/desktop-contract.test.mjs
git commit -m "build: package standalone Builder desktop runtime"
```

---

### Task 4: Windows Installer and Launch Helper

**Files:**
- Create: `scripts/install-desktop.ps1`
- Modify: `package.json`
- Modify: `tests/desktop-contract.test.mjs`

**Interfaces:**
- Consumes: NSIS artifact under `dist-desktop/`
- Produces: `npm run desktop:install`
- Produces: installed Windows application and shortcuts

- [ ] **Step 1: Add failing installer-helper tests**

```js
test('desktop install helper resolves exactly one generated setup executable', () => {
  const source = readFileSync('scripts/install-desktop.ps1', 'utf8');
  assert.match(source, /Autonomous-Project-Builder-Setup-.*\.exe/);
  assert.match(source, /Start-Process.*-Wait/);
  assert.match(source, /Resolve-Path/);
});
```

- [ ] **Step 2: Run installer-helper tests and verify RED**

Run: `node --test tests/desktop-contract.test.mjs`

Expected: FAIL because `scripts/install-desktop.ps1` does not exist.

- [ ] **Step 3: Implement the validated installer helper**

The PowerShell helper resolves `dist-desktop` inside the repository, requires exactly one matching Setup executable, refuses a path outside `dist-desktop`, launches it with `Start-Process -Wait`, and returns the installer exit code.

- [ ] **Step 4: Add the installation command and verify GREEN**

Add `"desktop:install": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop.ps1"`.

Run: `node --test tests/desktop-contract.test.mjs`

Expected: all desktop contract tests PASS.

- [ ] **Step 5: Commit the installer helper**

```powershell
git add scripts/install-desktop.ps1 package.json tests/desktop-contract.test.mjs
git commit -m "feat: add validated Windows desktop installer"
```

---

### Task 5: Package, Install, and Desktop Acceptance

**Files:**
- Modify only if a failing acceptance check identifies a defect in a file from Tasks 1 through 4.
- Verify: `dist-desktop/Autonomous-Project-Builder-Setup-<version>.exe`

**Interfaces:**
- Consumes: all desktop implementation and packaging commands
- Produces: a verified installer and installed desktop application

- [ ] **Step 1: Run the complete repository verification gate**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run build`

Expected: every command exits 0, with zero failing tests and no workspace-root warning.

- [ ] **Step 2: Build the unpacked desktop application**

Run: `npm run desktop:package`

Expected: `dist-desktop/win-unpacked/Autonomous Project Builder.exe` exists and packaged resources include `builder/server.js` but no `.env`, SQLite database, token file, or logs.

- [ ] **Step 3: Smoke-test the unpacked native window**

Launch the unpacked executable. Verify a Windows process named `Autonomous Project Builder` owns a visible top-level window titled `Autonomous Project Builder`, the UI reports `Core ready`, existing build history is visible, and the main-process/renderer console has no fatal errors.

- [ ] **Step 4: Build the NSIS installer**

Run: `npm run desktop:installer`

Expected: exactly one `dist-desktop/Autonomous-Project-Builder-Setup-<version>.exe` exists and has a nonzero size.

- [ ] **Step 5: Install and verify Windows shortcuts**

Run: `npm run desktop:install`

Expected: the installed executable exists beneath the current user's local application directory, and both desktop and Start Menu shortcuts resolve to it.

- [ ] **Step 6: Verify installed launch and persistence**

Close the unpacked application, launch **Autonomous Project Builder** from its installed shortcut, and verify the native window opens without a browser or terminal. Select the completed `Local E2E Smoke App` build from history and open its `http://127.0.0.1:3202` application.

- [ ] **Step 7: Verify restart behavior and secrets boundary**

Close and reopen the installed app. Verify history remains present, the Builder returns to ready after a controlled owned-server restart, and recursively scan installed resources for `.env` files and known secret variable values without printing those values.

- [ ] **Step 8: Record final evidence**

Record the installer absolute path, installed executable path, shortcut paths, Builder URL, desktop process/window evidence, repository verification counts, and any signing warning. Do not claim a signed installer unless an Authenticode certificate was actually applied and verified.

