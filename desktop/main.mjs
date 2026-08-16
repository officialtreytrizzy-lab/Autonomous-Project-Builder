import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';

// Keep Chromium's normal renderer. Forced software rendering caused an invisible desktop window on Computer 2.

import {
  buildServerLaunch,
  desktopOrigin,
  discoverComputer2Environment,
  ensureDesktopDirectories,
  isAllowedRendererNavigation,
  resolveDesktopPaths,
  restartDelay,
  secureWindowOptions,
  waitForCompatibleBuilder,
} from './runtime.mjs';

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(desktopDirectory, '..');
const port = process.env.BUILDER_PORT ? Number(process.env.BUILDER_PORT) : 3107;
const origin = desktopOrigin(port);
let mainWindow = null;
let ownedServer = null;
let shuttingDown = false;
let restartAttempt = 0;
let serverContext = null;
let windowCanClose = false;

function hostLog(event, details = {}) {
  try {
    const directory = join(app.getPath('userData'), 'logs');
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, 'desktop-host.log'), `${JSON.stringify({ timestamp: new Date().toISOString(), event, pid: process.pid, packaged: app.isPackaged, ...details })}\n`, 'utf8');
  } catch {}
}

hostLog('module-start', { argv: process.argv.slice(1) });

function validationReport() {
  return {
    product: 'Autonomous Project Builder',
    origin,
    window: secureWindowOptions(),
    singleInstance: true,
    rendererCredentials: false,
  };
}

function surfaceMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.moveTop();
  mainWindow.focus();
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.moveTop();
    mainWindow.focus();
  }, 350);
}
function createBuilderWindow() {
  const options = secureWindowOptions();
  options.webPreferences = { ...options.webPreferences, preload: join(desktopDirectory, 'preload.cjs') };
  hostLog('window-create-start', { options: { width: options.width, height: options.height, minWidth: options.minWidth, minHeight: options.minHeight, show: options.show } });
  const window = new BrowserWindow(options);
  hostLog('window-created', { id: window.id });
  window.loadFile(join(desktopDirectory, 'startup.html'));
  window.once('ready-to-show', () => {
    hostLog('window-ready-to-show', { id: window.id });
    window.show();
    window.setAlwaysOnTop(true, 'floating');
    window.moveTop();
    window.focus();
    setTimeout(() => {
      if (window.isDestroyed()) return;
      window.setAlwaysOnTop(false);
      window.moveTop();
      window.focus();
    }, 350);
  });
  window.on('show', () => hostLog('window-show', { id: window.id }));
  window.on('close', (event) => {
    if (!shuttingDown && !windowCanClose) {
      event.preventDefault();
      hostLog('startup-close-blocked', { id: window.id });
      setTimeout(() => surfaceMainWindow(), 60);
      return;
    }
    hostLog('window-close-allowed', { id: window.id, shuttingDown, windowCanClose });
  });
  window.on('closed', () => hostLog('window-closed', { id: window.id }));
  window.on('unresponsive', () => hostLog('window-unresponsive', { id: window.id }));
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => hostLog('did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame }));
  window.webContents.on('render-process-gone', (_event, details) => hostLog('render-process-gone', details));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererNavigation(url, origin) && !url.startsWith('file:')) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  return window;
}

function spawnOwnedServer() {
  if (!serverContext || shuttingDown) return;
  const { paths, environment } = serverContext;
  let launch;
  if (app.isPackaged) {
    launch = buildServerLaunch({
      electronExecutable: process.execPath,
      serverPath: paths.serverPath,
      origin,
      stateDb: paths.stateDb,
      projectsRoot: paths.projectsRoot,
      secretVault: paths.secretVault,
      intakeWorker: paths.intakeWorker,
      buildWorker: paths.buildWorker,
      serverEnvironment: environment,
      baseEnvironment: process.env,
    });
  } else {
    launch = {
      command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
      args: ['run', 'dev', '--', '-H', '127.0.0.1', '-p', String(port)],
      cwd: projectRoot,
      env: {
        ...process.env,
        ...environment,
        BUILDER_PORT: String(port),
        BUILDER_STATE_DB: paths.stateDb,
        BUILDER_PROJECTS_ROOT: paths.projectsRoot,
        BUILDER_SECRET_VAULT: paths.secretVault,
        BUILDER_INTAKE_WORKER: paths.intakeWorker,
        BUILDER_BUILD_WORKER: paths.buildWorker,
      },
    };
  }

  const stdout = openSync(join(paths.logDirectory, 'desktop-builder.stdout.log'), 'a');
  const stderr = openSync(join(paths.logDirectory, 'desktop-builder.stderr.log'), 'a');
  hostLog('server-spawn-start', { command: launch.command, cwd: launch.cwd });
  ownedServer = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    windowsHide: true,
    stdio: ['ignore', stdout, stderr],
  });
  hostLog('server-spawned', { serverPid: ownedServer.pid });
  ownedServer.once('exit', (code, signal) => {
    hostLog('server-exit', { code, signal });
    ownedServer = null;
    if (shuttingDown) return;
    const delay = restartDelay(restartAttempt);
    restartAttempt += 1;
    if (delay === null) {
      void showStartupFailure('The local Builder stopped repeatedly. Reopen the application to retry.');
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadFile(join(desktopDirectory, 'startup.html'));
    setTimeout(() => {
      spawnOwnedServer();
      void connectWindowToBuilder();
    }, delay);
  });
}

async function connectWindowToBuilder() {
  hostLog('connect-start', { origin });
  const health = await waitForCompatibleBuilder({ origin, attempts: 60, delayMs: 500 });
  hostLog('connect-health', { status: health.status });
  if (health.status !== 'compatible') {
    await showStartupFailure(health.status === 'incompatible'
      ? `Port ${port} belongs to another application.`
      : 'The local Builder did not become ready in time.');
    return false;
  }
  restartAttempt = 0;
  if (mainWindow && !mainWindow.isDestroyed()) {
    hostLog('load-origin-start', { origin });
    await mainWindow.loadURL(origin);
    windowCanClose = true;
    hostLog('load-origin-complete', { origin });
    surfaceMainWindow();
  }
  return true;
}

async function showStartupFailure(message) {
  windowCanClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadFile(join(desktopDirectory, 'startup.html'), { query: { error: message } });
  }
  if (!process.argv.includes('--desktop-smoke')) {
    await dialog.showMessageBox({ type: 'error', title: 'Autonomous Project Builder', message });
  }
}

ipcMain.handle('builder:select-repository-root', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select existing app or repository root',
    properties: ['openDirectory'],
    buttonLabel: 'Use this folder',
  });
  if (result.canceled || result.filePaths.length !== 1) return null;
  return { path: result.filePaths[0], name: result.filePaths[0].split(/[\\/]/).filter(Boolean).at(-1) || result.filePaths[0] };
});

ipcMain.handle('builder:select-input-folder', async (_event, options = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const title = typeof options?.title === 'string' ? options.title.slice(0, 160) : 'Choose required build-input folder';
  const result = await dialog.showOpenDialog(mainWindow, { title, properties: ['openDirectory'], buttonLabel: 'Use this folder' });
  if (result.canceled || result.filePaths.length !== 1) return null;
  const path = result.filePaths[0];
  return { path, name: path.split(/[\\/]/).filter(Boolean).at(-1) || path };
});

ipcMain.handle('builder:select-input-files', async (_event, options = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  const title = typeof options?.title === 'string' ? options.title.slice(0, 160) : 'Choose required build-input files';
  const extensions = Array.isArray(options?.extensions) ? options.extensions.map((value) => String(value).replace(/^\./, '').trim()).filter((value) => /^[A-Za-z0-9]+$/.test(value)).slice(0, 50) : [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openFile', 'multiSelections'],
    buttonLabel: 'Use these files',
    ...(extensions.length ? { filters: [{ name: 'Required files', extensions }, { name: 'All files', extensions: ['*'] }] } : {}),
  });
  if (result.canceled) return [];
  return result.filePaths.map((path) => ({ path, name: path.split(/[\\/]/).filter(Boolean).at(-1) || path }));
});
async function startDesktop() {
  hostLog('start-desktop');
  const paths = resolveDesktopPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    cwd: projectRoot,
    homeDirectory: homedir(),
  });
  ensureDesktopDirectories(paths);
  hostLog('paths-ready', { serverPath: paths.serverPath, intakeWorker: paths.intakeWorker, buildWorker: paths.buildWorker });
  hostLog('environment-discovery-start');
  const environment = await discoverComputer2Environment();
  hostLog('environment-discovery-complete', { keys: Object.keys(environment || {}) });
  serverContext = { paths, environment };
  mainWindow = createBuilderWindow();

  const existing = await waitForCompatibleBuilder({ origin, attempts: 1, delayMs: 0 });
  hostLog('initial-health', { status: existing.status });
  if (existing.status === 'compatible') {
    await mainWindow.loadURL(origin);
    windowCanClose = true;
    hostLog('load-existing-origin-complete', { origin });
    surfaceMainWindow();
    return;
  }
  if (existing.status === 'incompatible') {
    await showStartupFailure(`Port ${port} belongs to another application. Configure a different BUILDER_PORT and reopen the Builder.`);
    return;
  }
  if (!existsSync(paths.serverPath) && app.isPackaged) {
    await showStartupFailure('The packaged Builder server is missing. Reinstall Autonomous Project Builder.');
    return;
  }
  if (!existsSync(paths.intakeWorker) || !existsSync(paths.buildWorker)) {
    await showStartupFailure('A bundled autonomous worker is missing. Reinstall Autonomous Project Builder.');
    return;
  }
  spawnOwnedServer();
  await connectWindowToBuilder();
}

if (process.argv.includes('--desktop-validate')) {
  app.whenReady().then(() => {
    process.stdout.write(`${JSON.stringify(validationReport())}\n`);
    app.quit();
  });
} else {
  const hasLock = app.requestSingleInstanceLock();
  hostLog('single-instance-lock', { hasLock });
  if (!hasLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      surfaceMainWindow();
    });

    app.whenReady().then(async () => {
      hostLog('app-ready');
      Menu.setApplicationMenu(null);
      app.setAppUserModelId('com.trizzy.autonomous-project-builder');
      await startDesktop();
    }).catch(async (error) => {
      hostLog('startup-error', { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' });
      await dialog.showMessageBox({
        type: 'error',
        title: 'Autonomous Project Builder',
        message: error instanceof Error ? error.message : String(error),
      });
      app.quit();
    });
  }
}

app.on('before-quit', () => {
  hostLog('before-quit');
  shuttingDown = true;
  if (ownedServer && !ownedServer.killed) ownedServer.kill();
});

app.on('window-all-closed', () => { hostLog('window-all-closed'); app.quit(); });
app.on('will-quit', () => hostLog('will-quit'));
app.on('quit', (_event, exitCode) => hostLog('quit', { exitCode }));
app.on('child-process-gone', (_event, details) => hostLog('child-process-gone', details));
