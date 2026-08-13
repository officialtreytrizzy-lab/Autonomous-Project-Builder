# Autonomous Project Builder Desktop Application Design

Date: 2026-08-13
Status: Approved design, pending specification review

## Purpose

Turn the existing private, local Autonomous Project Builder into a Windows desktop application that the user installs and opens normally. The desktop application must preserve the existing Builder supervisor, SQLite build history, Computer 2 MCP authentication, local project runtimes, and optional service integrations. It must not turn the Builder into a hosted or browser-dependent product.

## User Experience

The deliverable is a signed-ready Windows installer executable produced with Electron Builder and NSIS. Installation creates Start Menu and desktop shortcuts named **Autonomous Project Builder**. Opening either shortcut launches a single desktop window containing the existing Builder UI.

The user is not asked to open a terminal, paste an MCP token, choose a port, or open a browser. If another desktop window is already open, launching the shortcut focuses the existing window. Closing the window closes the desktop shell; the local Builder service may remain available for durable jobs and restart recovery.

The application displays a native startup/recovery screen while it ensures the local service is ready. If Computer 2 MCP is temporarily unavailable, the Builder window still opens and shows capability-specific degradation through the existing health UI.

## Architecture

The desktop layer is additive:

```text
Windows installer / shortcut
        |
Electron main process
        |-- single-instance lock
        |-- secure environment discovery
        |-- Builder service supervisor
        |-- native BrowserWindow
        |
Packaged Next.js standalone server on 127.0.0.1:3107
        |
Existing Builder APIs, SQLite state, Computer 2 MCP, Docker MCP, Windmill
```

Electron does not contain Builder credentials in renderer code. Its main process discovers the Computer 2 installation through the existing health endpoint, reads only the allow-listed server environment variables from Computer 2 configuration, and passes them directly to the packaged Builder server process. Values are never serialized into HTML, preload APIs, logs, installer metadata, or packaged source files.

The Next.js application uses standalone output. Packaging includes the standalone server, static assets, Electron main-process code, and required application resources. Electron runs the standalone server using its bundled Node runtime, so an end user does not need a separate Node.js or npm installation.

## Desktop Process Lifecycle

On launch, the Electron main process:

1. Acquires a single-instance lock or focuses the existing window.
2. Checks whether a compatible Builder already owns the configured port, defaulting to 3107.
3. Discovers and imports allow-listed server-only configuration.
4. Starts the packaged Builder server if it is not already healthy.
5. Polls `/api/health` within a bounded startup window.
6. Opens the native window as soon as the Builder responds.
7. Monitors the Builder child process and restarts it after an unexpected exit while the desktop shell remains active.

The service uses the existing SQLite database location and local projects root, keeping build history and generated applications stable across desktop upgrades. The packaged application never stores state inside its versioned installation directory.

The main process shuts down only the Builder process it owns. It does not stop Computer 2 MCP, Docker, Windmill, authenticated Chrome, generated applications, or a compatible externally supervised Builder instance.

## Security Boundaries

- Renderer navigation is limited to the local Builder origin.
- Node integration is disabled in the renderer.
- Context isolation and Chromium sandboxing are enabled.
- No generic preload bridge, shell execution API, or credential API is exposed to the renderer.
- New windows and unexpected external navigation are denied; explicitly approved local application links may open through the operating system browser.
- MCP, Docker gateway, Windmill, cookies, and service tokens remain server-side.
- Logs redact sensitive keys using the existing structured-log redaction rules.
- Installer and packaged resources contain no environment files or runtime database.

## Packaging and Installation

Electron Builder produces an NSIS installer in `dist-desktop/`. The product identifier and application data directory remain stable across upgrades. The installer creates desktop and Start Menu shortcuts and supports normal Windows uninstall behavior.

The application data directory stores desktop runtime logs and configuration that are safe to persist. Authoritative Builder state remains in the configured SQLite path. Project workspaces remain under the configured Builder projects root.

The implementation adds these npm commands:

- `npm run desktop:dev` for a development desktop window against the local Builder.
- `npm run desktop:package` for an unpacked production bundle.
- `npm run desktop:installer` for the Windows installer.
- `npm run desktop:test` for desktop lifecycle and security contract tests.

## Error Handling

Port collisions are accepted only when the listener identifies as a compatible Autonomous Builder health endpoint. An unrelated listener produces a clear native startup error and does not get terminated.

Missing Computer 2 credentials do not leak into the renderer. The desktop shell opens the Builder in degraded mode where safe; build execution remains blocked only when the existing RED dependency policy says Computer 2 is truly unavailable.

Unexpected Builder exits use bounded restart attempts with increasing delay. Repeated failure produces a native error screen with retry and open-log actions. The shell does not enter an infinite rapid restart loop.

Installer creation failure, missing packaged assets, incompatible ports, and server startup timeout return nonzero build or launch outcomes with actionable messages.

## Testing

Automated tests cover:

- single-instance behavior;
- compatible versus conflicting port ownership;
- server-only environment parsing and allow-listing;
- absence of secrets in renderer/preload and packaged configuration;
- startup health polling;
- bounded server restart behavior;
- packaged path resolution;
- persistent database and project-root selection;
- safe navigation policy;
- installer configuration and expected shortcuts.

The verification pipeline is:

```text
npm run lint
npm run typecheck
npm test
npm run build
npm run desktop:test
npm run desktop:package
npm run desktop:installer
```

The final desktop smoke test installs or launches the packaged application, confirms a native window reaches the Builder UI, reopens existing build history, opens a completed local application, and verifies the desktop app contains no fatal console or main-process errors.

## Acceptance Criteria

The feature is complete only when:

1. A Windows installer executable exists.
2. Installation creates working desktop and Start Menu shortcuts.
3. Opening the shortcut shows the Builder in a native desktop window.
4. No browser tab or terminal interaction is required.
5. Computer 2 MCP credentials remain server-side.
6. Existing build history survives installation and relaunch.
7. A completed local application remains openable from the desktop Builder.
8. Closing and reopening the desktop application restores authoritative state.
9. The installer, packaged application, repository tests, and production build all pass.

## Non-Goals

- Rewriting the Builder UI in a native UI toolkit.
- Moving Computer 2 MCP or authenticated Chrome into Electron.
- Bundling service credentials into the installer.
- Requiring GitHub, Vercel, or an external deployment.
- Replacing the existing web UI; Electron hosts the same local control surface.
