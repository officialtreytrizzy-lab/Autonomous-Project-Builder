import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const ALLOWED_SERVER_ENVIRONMENT = new Set([
  'MCP_AUTH_TOKEN',
  'BUILDER_SERVICE_TOKEN',
  'MCP_MAIN_NODE_URL',
  'COMPUTER2_MCP_URL',
  'COMPUTER2_HEALTH_URL',
  'DOCKER_MCP_GATEWAY_TOKEN',
  'DOCKER_MCP_GATEWAY_URL',
  'DOCKER_MCP_GATEWAY_HEALTH_URL',
  'MCP_GATEWAY_AUTH_TOKEN',
  'WINDMILL_URL',
  'BUILDER_PROJECTS_ROOT',
  'BUILDER_STATE_DB',
]);

export function parseAllowedEnvironment(text) {
  const parsed = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !ALLOWED_SERVER_ENVIRONMENT.has(match[1])) continue;
    let value = match[2].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

export function desktopOrigin(port = 3107) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
    throw new Error('Builder port must be a valid TCP port between 1 and 65535.');
  }
  if (numericPort === 3000) throw new Error('Port 3000 is reserved for Computer 2 MCP.');
  return `http://127.0.0.1:${numericPort}`;
}

export function classifyBuilderHealth(payload) {
  if (!payload || typeof payload !== 'object') return 'incompatible';
  return payload.architecture === 'hybrid-docker-mcp' ? 'compatible' : 'incompatible';
}

export function isAllowedRendererNavigation(url, origin) {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function resolveDesktopPaths({ isPackaged, resourcesPath, userDataPath, cwd, homeDirectory }) {
  const stateDirectory = join(userDataPath, 'state');
  return {
    userDataPath,
    serverPath: isPackaged ? join(resourcesPath, 'builder', 'server.js') : join(cwd, '.next', 'standalone', 'server.js'),
    stateDb: join(stateDirectory, 'state.db'),
    projectsRoot: join(homeDirectory, 'Autonomous-Builder-Projects'),
    logDirectory: join(userDataPath, 'logs'),
    legacyStateDb: join(cwd, '.builder', 'state.db'),
  };
}

export function restartDelay(attempt) {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= 5) return null;
  return Math.min(8000, 500 * (2 ** attempt));
}

export function secureWindowOptions() {
  return {
    width: 1440,
    height: 960,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    backgroundColor: '#0b1015',
    title: 'Autonomous Project Builder',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForCompatibleBuilder({ origin, attempts = 30, delayMs = 500, fetchImpl = fetch }) {
  let lastError = 'Builder did not respond.';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${origin}/api/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      const payload = await response.json();
      const status = classifyBuilderHealth(payload);
      if (status === 'compatible') return { status, payload };
      return { status: 'incompatible', payload };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt + 1 < attempts && delayMs > 0) await wait(delayMs);
    }
  }
  return { status: 'unavailable', error: lastError };
}

export function buildServerLaunch({
  electronExecutable,
  serverPath,
  origin,
  stateDb,
  projectsRoot,
  serverEnvironment = {},
  baseEnvironment = process.env,
}) {
  const url = new URL(origin);
  return {
    command: electronExecutable,
    args: [serverPath],
    cwd: dirname(serverPath),
    env: {
      ...baseEnvironment,
      ...serverEnvironment,
      ELECTRON_RUN_AS_NODE: '1',
      HOSTNAME: url.hostname,
      PORT: url.port,
      BUILDER_PORT: url.port,
      BUILDER_STATE_DB: stateDb,
      BUILDER_PROJECTS_ROOT: projectsRoot,
      NODE_ENV: 'production',
    },
  };
}

function allowedFromEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment || {})
    .filter(([key, value]) => ALLOWED_SERVER_ENVIRONMENT.has(key) && typeof value === 'string' && value.length > 0));
}

export async function discoverComputer2Environment({
  existingEnvironment = process.env,
  healthUrl = existingEnvironment.COMPUTER2_HEALTH_URL || 'http://127.0.0.1:3000/health/deep',
  fetchImpl = fetch,
  readFileImpl = (path) => readFile(path, 'utf8'),
} = {}) {
  const discovered = allowedFromEnvironment(existingEnvironment);
  let baseDirectory = existingEnvironment.COMPUTER2_HOME || '';
  if (!baseDirectory) {
    try {
      const response = await fetchImpl(healthUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const payload = await response.json();
      if (typeof payload.baseDirectory === 'string') baseDirectory = payload.baseDirectory;
    } catch {
      baseDirectory = '';
    }
  }
  if (baseDirectory) {
    for (const filename of ['.env.local', '.env.mcp']) {
      try {
        const contents = await readFileImpl(join(baseDirectory, filename));
        const parsed = parseAllowedEnvironment(contents);
        for (const [key, value] of Object.entries(parsed)) if (!discovered[key]) discovered[key] = value;
      } catch {
        // Each optional Computer 2 environment file is discovered independently.
      }
    }
  }
  if (!discovered.BUILDER_SERVICE_TOKEN && discovered.MCP_AUTH_TOKEN) {
    discovered.BUILDER_SERVICE_TOKEN = discovered.MCP_AUTH_TOKEN;
  }
  if (!discovered.COMPUTER2_MCP_URL && !discovered.MCP_MAIN_NODE_URL) {
    discovered.COMPUTER2_MCP_URL = 'http://127.0.0.1:3000/mcp';
  }
  return discovered;
}

export function ensureDesktopDirectories(paths) {
  mkdirSync(dirname(paths.stateDb), { recursive: true });
  mkdirSync(paths.logDirectory, { recursive: true });
  mkdirSync(paths.projectsRoot, { recursive: true });
  if (!existsSync(paths.stateDb) && paths.legacyStateDb && existsSync(paths.legacyStateDb)) {
    copyFileSync(paths.legacyStateDb, paths.stateDb);
    for (const suffix of ['-wal', '-shm']) {
      const legacySidecar = `${paths.legacyStateDb}${suffix}`;
      if (existsSync(legacySidecar)) copyFileSync(legacySidecar, `${paths.stateDb}${suffix}`);
    }
  }
  return paths;
}
