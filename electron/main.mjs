import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeTheme, shell } from 'electron';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3001;
const APP_URL = `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let tray = null;
let serverProcess = null;

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Force dark theme for native dialogs/menus
nativeTheme.themeSource = 'dark';

async function isServerRunning(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status === 207;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning(url)) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

function startNextServer() {
  const projectRoot = join(__dirname, '..');
  serverProcess = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: projectRoot,
    shell: true,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start Next.js server:', err);
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#07110e',
    title: 'Autonomous Project Builder',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    autoHideMenuBar: true,
    show: false,
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.on('desktop:notify', (_event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({
      title: title || 'Autonomous Project Builder',
      body: body || '',
      silent: false,
    }).show();
  }
});

ipcMain.handle('desktop:open-path', async (_event, targetPath) => {
  if (typeof targetPath === 'string') {
    return shell.openPath(targetPath);
  }
  return '';
});

ipcMain.on('desktop:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('desktop:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('desktop:close', () => {
  mainWindow?.close();
});

// App Lifecycle
app.whenReady().then(async () => {
  const alreadyRunning = await isServerRunning(APP_URL);
  if (!alreadyRunning) {
    startNextServer();
  }

  const ready = await waitForServer(APP_URL);
  if (!ready) {
    console.warn('Server did not respond within timeout, attempting to load URL directly...');
  }

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {}
  }
});
