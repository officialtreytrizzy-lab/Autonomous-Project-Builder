import { app, BrowserWindow, ipcMain, Notification, nativeTheme, shell, dialog } from 'electron';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import next from 'next';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT || '3001', 10);
const APP_URL = `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let httpServer = null;
let isStartingServer = false;

// Force dark theme
nativeTheme.themeSource = 'dark';

// Single-instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getAppRoot() {
  if (app.isPackaged) {
    return app.getAppPath();
  }
  return join(__dirname, '..');
}

async function isServerRunning(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1200) });
    return res.ok || res.status === 207 || res.status === 200;
  } catch {
    return false;
  }
}

async function startInProcessNextServer() {
  if (httpServer || isStartingServer) return;
  isStartingServer = true;

  const appDir = getAppRoot();
  console.log(`[Desktop] Starting in-process Next.js server in ${appDir} (packaged: ${app.isPackaged})...`);

  try {
    const nextApp = next({
      dev: !app.isPackaged && process.env.NODE_ENV === 'development',
      dir: appDir,
      port: PORT,
      hostname: '127.0.0.1',
    });

    const handle = nextApp.getRequestHandler();
    await nextApp.prepare();

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        handle(req, res);
      });

      server.on('error', (err) => {
        console.error('[Desktop] Server error:', err);
        isStartingServer = false;
        reject(err);
      });

      server.listen(PORT, '127.0.0.1', () => {
        httpServer = server;
        isStartingServer = false;
        console.log(`[Desktop] Next.js server listening on ${APP_URL}`);
        resolve(server);
      });
    });
  } catch (err) {
    isStartingServer = false;
    console.error('[Desktop] Failed to prepare Next.js app:', err);
    throw err;
  }
}

const SPLASH_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Autonomous Project Builder</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #07110e;
      color: #e6f1ed;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      width: 100vw;
      user-select: none;
      overflow: hidden;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border: 3px solid rgba(16, 185, 129, 0.15);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
      margin-bottom: 24px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    h1 {
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    p {
      font-size: 13px;
      color: #94a3b8;
      letter-spacing: 0.01em;
    }
    .pill {
      margin-top: 16px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      color: #10b981;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #10b981;
      box-shadow: 0 0 8px #10b981;
    }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <h1>Autonomous Project Builder</h1>
  <p id="status-text">Initializing autonomous environment & local services...</p>
  <div class="pill">
    <span class="dot"></span>
    <span>Desktop Host Initializing</span>
  </div>
</body>
</html>
`;

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
    show: true, // Show immediately with splash
  });

  // Load splash screen immediately
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);

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

async function connectWindowToApp(retries = 30) {
  for (let i = 0; i < retries; i++) {
    const running = await isServerRunning(APP_URL);
    if (running && mainWindow && !mainWindow.isDestroyed()) {
      console.log(`[Desktop] Loading ${APP_URL} into window...`);
      mainWindow.loadURL(APP_URL);
      return true;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
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
  createMainWindow();

  try {
    const running = await isServerRunning(APP_URL);
    if (!running) {
      await startInProcessNextServer();
    }
    const connected = await connectWindowToApp();
    if (!connected) {
      throw new Error(`Failed to connect to local server at ${APP_URL} within timeout.`);
    }
  } catch (err) {
    console.error('[Desktop] Boot error:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        document.getElementById('status-text').innerText = "Boot error: ${err.message.replace(/"/g, '\\"')}";
        document.getElementById('status-text').style.color = '#ef4444';
      `).catch(() => {});
    }
  }

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
  if (httpServer) {
    try {
      httpServer.close();
    } catch {}
  }
});
