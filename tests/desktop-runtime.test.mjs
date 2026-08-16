import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  classifyBuilderHealth,
  desktopOrigin,
  isAllowedRendererNavigation,
  parseAllowedEnvironment,
  resolveDesktopPaths,
  restartDelay,
  secureWindowOptions,
} from '../desktop/runtime.mjs';

test('environment parsing imports only server allow-list keys', () => {
  const parsed = parseAllowedEnvironment([
    '# Computer 2 server configuration',
    'MCP_AUTH_TOKEN="server-secret"',
    'NEXT_PUBLIC_TOKEN=renderer-leak',
    "WINDMILL_URL='http://127.0.0.1'",
    'DOCKER_MCP_GATEWAY_TOKEN=gateway-secret',
    'MALFORMED',
  ].join('\n'));

  assert.deepEqual(parsed, {
    MCP_AUTH_TOKEN: 'server-secret',
    WINDMILL_URL: 'http://127.0.0.1',
    DOCKER_MCP_GATEWAY_TOKEN: 'gateway-secret',
  });
});

test('Builder origin validates the dedicated port and rejects Computer 2 port 3000', () => {
  assert.equal(desktopOrigin(), 'http://127.0.0.1:3107');
  assert.equal(desktopOrigin(3199), 'http://127.0.0.1:3199');
  assert.throws(() => desktopOrigin(3000), /reserved for Computer 2 MCP/i);
  assert.throws(() => desktopOrigin(70_000), /valid TCP port/i);
});

test('health classification accepts only the Autonomous Builder contract', () => {
  assert.equal(classifyBuilderHealth({ status: 'ready', architecture: 'hybrid-docker-mcp' }), 'compatible');
  assert.equal(classifyBuilderHealth({ status: 'unavailable', architecture: 'hybrid-docker-mcp' }), 'compatible');
  assert.equal(classifyBuilderHealth({ status: 'ok' }), 'incompatible');
  assert.equal(classifyBuilderHealth(null), 'incompatible');
});

test('renderer navigation is restricted to the exact Builder origin', () => {
  const origin = 'http://127.0.0.1:3107';
  assert.equal(isAllowedRendererNavigation(`${origin}/` , origin), true);
  assert.equal(isAllowedRendererNavigation(`${origin}/api/health`, origin), true);
  assert.equal(isAllowedRendererNavigation('http://127.0.0.1:3202', origin), false);
  assert.equal(isAllowedRendererNavigation('https://example.com', origin), false);
  assert.equal(isAllowedRendererNavigation('not a url', origin), false);
});

test('desktop paths keep writable state outside packaged resources', () => {
  const paths = resolveDesktopPaths({
    isPackaged: true,
    resourcesPath: 'C:\\Program Files\\Autonomous Project Builder\\resources',
    userDataPath: 'C:\\Users\\tester\\AppData\\Roaming\\Autonomous Project Builder',
    cwd: 'C:\\source\\builder',
    homeDirectory: 'C:\\Users\\tester',
  });

  assert.equal(paths.serverPath, join('C:\\Program Files\\Autonomous Project Builder\\resources', 'builder', 'server.js'));
  assert.equal(paths.buildWorker, join('C:\\Program Files\\Autonomous Project Builder\\resources', 'builder-worker', 'build-worker.mjs'));
  assert.equal(paths.stateDb, join('C:\\Users\\tester\\AppData\\Roaming\\Autonomous Project Builder', 'state', 'state.db'));
  assert.equal(paths.projectsRoot, 'C:\\Users\\tester');
  assert.equal(paths.logDirectory, join('C:\\Users\\tester\\AppData\\Roaming\\Autonomous Project Builder', 'logs'));
  assert.equal(paths.serverPath.startsWith(paths.userDataPath), false);
});

test('restart delay uses bounded exponential backoff', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(restartDelay), [500, 1000, 2000, 4000, 8000, null]);
});

test('native window policy denies renderer privileges', () => {
  const options = secureWindowOptions();
  assert.deepEqual(options.webPreferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  });
  assert.equal(options.width, 1440);
  assert.equal(options.show, false);
});
