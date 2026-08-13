import { join } from 'node:path';

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
