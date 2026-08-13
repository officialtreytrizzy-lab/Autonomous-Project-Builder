import { spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, shell } from 'electron';

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

function validationReport() {
  return {
    product: 'Autonomous Project Builder',
    origin,
    window: secureWindowOptions(),
    singleInstance: true,
    rendererCredentials: false,
  };
}

function createBuilderWindow() {
  const window = new BrowserWindow(secureWindowOptions());
  window.loadFile(join(desktopDirectory, 'startup.html'));
  window.once('ready-to-show', () => window.show());
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
      intakeWorker: paths.intakeWorker,
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
        BUILDER_INTAKE_WORKER: paths.intakeWorker,
      },
    };
  }

  const stdout = openSync(join(paths.logDirectory, 'desktop-builder.stdout.log'), 'a');
  const stderr = openSync(join(paths.logDirectory, 'desktop-builder.stderr.log'), 'a');
  ownedServer = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    windowsHide: true,
    stdio: ['ignore', stdout, stderr],
  });
  ownedServer.once('exit', () => {
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
  const health = await waitForCompatibleBuilder({ origin, attempts: 60, delayMs: 500 });
  if (health.status !== 'compatible') {
    await showStartupFailure(health.status === 'incompatible'
      ? `Port ${port} belongs to another application.`
      : 'The local Builder did not become ready in time.');
    return false;
  }
  restartAttempt = 0;
  if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(origin);
  return true;
}

async function showStartupFailure(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadFile(join(desktopDirectory, 'startup.html'), { query: { error: message } });
  }
  if (!process.argv.includes('--desktop-smoke')) {
    await dialog.showMessageBox({ type: 'error', title: 'Autonomous Project Builder', message });
  }
}

async function startDesktop() {
  const paths = resolveDesktopPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    cwd: projectRoot,
    homeDirectory: homedir(),
  });
  ensureDesktopDirectories(paths);
  const environment = await discoverComputer2Environment();
  serverContext = { paths, environment };
  mainWindow = createBuilderWindow();

  const existing = await waitForCompatibleBuilder({ origin, attempts: 1, delayMs: 0 });
  if (existing.status === 'compatible') {
    await mainWindow.loadURL(origin);
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
  if (!existsSync(paths.intakeWorker)) {
    await showStartupFailure('The local document understanding worker is missing. Reinstall Autonomous Project Builder.');
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
  if (!hasLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });

    app.whenReady().then(async () => {
      app.setAppUserModelId('com.trizzy.autonomous-project-builder');
      await startDesktop();
    }).catch(async (error) => {
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
  shuttingDown = true;
  if (ownedServer && !ownedServer.killed) ownedServer.kill();
});

app.on('window-all-closed', () => app.quit());
