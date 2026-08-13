import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  buildServerLaunch,
  discoverComputer2Environment,
  ensureDesktopDirectories,
  waitForCompatibleBuilder,
} from '../desktop/runtime.mjs';
import {
  loadDesktopBuilderConfig,
  prepareDesktopBundle,
  validateDesktopBundle,
} from '../scripts/prepare-desktop.mjs';

test('health polling accepts only the Autonomous Builder architecture', async () => {
  const result = await waitForCompatibleBuilder({
    origin: 'http://127.0.0.1:3107',
    attempts: 1,
    fetchImpl: async () => new Response(JSON.stringify({ status: 'ready', architecture: 'hybrid-docker-mcp' }), { status: 200 }),
  });

  assert.deepEqual(result, {
    status: 'compatible',
    payload: { status: 'ready', architecture: 'hybrid-docker-mcp' },
  });
});

test('health polling identifies an unrelated process on the Builder port', async () => {
  const result = await waitForCompatibleBuilder({
    origin: 'http://127.0.0.1:3107',
    attempts: 1,
    fetchImpl: async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
  });

  assert.equal(result.status, 'incompatible');
});

test('health polling distinguishes an unused port from an incompatible listener', async () => {
  const result = await waitForCompatibleBuilder({
    origin: 'http://127.0.0.1:3107',
    attempts: 2,
    delayMs: 0,
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.error, 'fetch failed');
});

test('packaged server launch uses Electron as Node without exposing configuration in arguments', () => {
  const launch = buildServerLaunch({
    electronExecutable: 'C:\\Program Files\\Builder\\Autonomous Project Builder.exe',
    serverPath: 'C:\\Program Files\\Builder\\resources\\builder\\server.js',
    origin: 'http://127.0.0.1:3107',
    stateDb: 'C:\\Users\\tester\\AppData\\Roaming\\Builder\\state\\state.db',
    projectsRoot: 'C:\\Users\\tester\\Autonomous-Builder-Projects',
    serverEnvironment: { MCP_AUTH_TOKEN: 'server-secret' },
    baseEnvironment: { PATH: 'C:\\Windows\\System32' },
  });

  assert.deepEqual(launch.args, ['C:\\Program Files\\Builder\\resources\\builder\\server.js']);
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(launch.env.HOSTNAME, '127.0.0.1');
  assert.equal(launch.env.PORT, '3107');
  assert.equal(launch.env.BUILDER_STATE_DB.endsWith('state.db'), true);
  assert.equal(launch.env.MCP_AUTH_TOKEN, 'server-secret');
  assert.equal(launch.args.join(' ').includes('server-secret'), false);
});

test('Computer 2 discovery imports server configuration without overriding inherited values', async () => {
  const files = new Map([
    ['C:\\computer2\\.env.local', 'MCP_AUTH_TOKEN=file-secret\nNEXT_PUBLIC_TOKEN=leak'],
    ['C:\\computer2\\.env.mcp', 'WINDMILL_URL=http://127.0.0.1\nDOCKER_MCP_GATEWAY_TOKEN=gateway'],
  ]);
  const environment = await discoverComputer2Environment({
    existingEnvironment: { MCP_AUTH_TOKEN: 'inherited-secret' },
    fetchImpl: async () => new Response(JSON.stringify({ baseDirectory: 'C:\\computer2' })),
    readFileImpl: async (path) => files.get(path) ?? Promise.reject(new Error('missing')),
  });

  assert.equal(environment.MCP_AUTH_TOKEN, 'inherited-secret');
  assert.equal(environment.BUILDER_SERVICE_TOKEN, 'inherited-secret');
  assert.equal(environment.WINDMILL_URL, 'http://127.0.0.1');
  assert.equal(environment.NEXT_PUBLIC_TOKEN, undefined);
});

test('desktop directory setup migrates existing SQLite state on first launch', () => {
  const root = mkdtempSync(join(tmpdir(), 'builder-desktop-state-'));
  try {
    const paths = {
      stateDb: join(root, 'user-data', 'state', 'state.db'),
      logDirectory: join(root, 'user-data', 'logs'),
      projectsRoot: join(root, 'projects'),
      legacyStateDb: join(root, 'legacy', 'state.db'),
    };
    mkdirSync(join(root, 'legacy'), { recursive: true });
    writeFileSync(paths.legacyStateDb, 'sqlite-fixture');
    ensureDesktopDirectories(paths);
    assert.equal(readFileSync(paths.stateDb, 'utf8'), 'sqlite-fixture');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Electron entry reports a secure native configuration without secrets', () => {
  const electron = process.platform === 'win32'
    ? join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
    : join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron');
  const result = spawnSync(electron, ['.', '--desktop-validate'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, MCP_AUTH_TOKEN: 'must-not-print' },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(report.origin, 'http://127.0.0.1:3107');
  assert.equal(report.window.webPreferences.nodeIntegration, false);
  assert.equal(report.window.webPreferences.contextIsolation, true);
  assert.equal(report.window.webPreferences.sandbox, true);
  assert.equal(JSON.stringify(report).includes('must-not-print'), false);
});

test('staging copies standalone static assets and rejects secret-bearing file types', () => {
  const root = mkdtempSync(join(tmpdir(), 'builder-desktop-bundle-'));
  try {
    const standaloneDirectory = join(root, 'standalone');
    const staticDirectory = join(root, 'static');
    const publicDirectory = join(root, 'public');
    mkdirSync(standaloneDirectory, { recursive: true });
    mkdirSync(staticDirectory, { recursive: true });
    mkdirSync(publicDirectory, { recursive: true });
    mkdirSync(join(standaloneDirectory, '.builder'), { recursive: true });
    writeFileSync(join(standaloneDirectory, 'server.js'), 'server');
    writeFileSync(join(standaloneDirectory, '.builder', 'state.db'), 'live-state-must-not-ship');
    writeFileSync(join(staticDirectory, 'chunk.js'), 'chunk');
    writeFileSync(join(publicDirectory, 'asset.txt'), 'asset');

    prepareDesktopBundle({ standaloneDirectory, staticDirectory, publicDirectory });
    assert.equal(existsSync(join(standaloneDirectory, '.next', 'static', 'chunk.js')), true);
    assert.equal(existsSync(join(standaloneDirectory, 'public', 'asset.txt')), true);
    assert.equal(existsSync(join(standaloneDirectory, '.builder')), false);

    writeFileSync(join(standaloneDirectory, '.env.local'), 'MCP_AUTH_TOKEN=secret');
    assert.throws(() => validateDesktopBundle(standaloneDirectory), /forbidden packaged file/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('desktop packaging contract creates NSIS desktop and Start Menu shortcuts', () => {
  const config = loadDesktopBuilderConfig(join(process.cwd(), 'desktop-builder.yml'));
  assert.equal(config.win.target, 'nsis');
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.createDesktopShortcut, true);
  assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.nsis.shortcutName, 'Autonomous Project Builder');
  assert.equal(config.directories.output, 'dist-desktop');
  assert.equal(config.extraResources.some((entry) => entry.to === 'builder'), true);
});
