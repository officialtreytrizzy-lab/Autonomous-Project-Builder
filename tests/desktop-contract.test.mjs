import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  buildServerLaunch,
  discoverComputer2Environment,
  ensureDesktopDirectories,
  resolveDesktopPaths,
  secureWindowOptions,
  waitForCompatibleBuilder,
} from '../desktop/runtime.mjs';
import { generateDesktopIcon } from '../scripts/generate-desktop-icon.mjs';
import { loadDesktopBuilderConfig, prepareDesktopBundle, validateDesktopBundle } from '../scripts/prepare-desktop.mjs';
import { verifyDesktopPackage } from '../scripts/verify-desktop-package.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const nodeExecutable = process.execPath;
const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

function tempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('health polling accepts only the Autonomous Builder architecture', async () => {
  const result = await waitForCompatibleBuilder({
    origin: 'http://127.0.0.1:3107',
    attempts: 1,
    delayMs: 0,
    fetchImpl: async () => new Response(JSON.stringify({ architecture: 'hybrid-docker-mcp', status: 'ready' })),
  });
  assert.equal(result.status, 'compatible');
  assert.equal(result.payload.status, 'ready');
});

test('health polling identifies an unrelated process on the Builder port', async () => {
  const result = await waitForCompatibleBuilder({
    origin: 'http://127.0.0.1:3107',
    attempts: 1,
    delayMs: 0,
    fetchImpl: async () => new Response(JSON.stringify({ architecture: 'something-else' })),
  });
  assert.equal(result.status, 'incompatible');
});

test('health polling distinguishes an unused port from an incompatible listener', async () => {
  const result = await waitForCompatibleBuilder({
    origin: 'http://127.0.0.1:3107',
    attempts: 2,
    delayMs: 0,
    fetchImpl: async () => { throw new TypeError('connection refused'); },
  });
  assert.equal(result.status, 'unavailable');
  assert.match(result.error, /connection refused/i);
});

test('packaged server launch uses Electron as Node without exposing configuration in arguments', () => {
  const launch = buildServerLaunch({
    electronExecutable: 'Builder.exe',
    serverPath: 'C:\\app\\resources\\builder\\server.js',
    origin: 'http://127.0.0.1:3107',
    stateDb: 'C:\\state\\state.db',
    projectsRoot: 'C:\\projects',
    intakeWorker: 'C:\\app\\resources\\builder-worker\\intake-worker.mjs',
    buildWorker: 'C:\\app\\resources\\builder-worker\\build-worker.mjs',
    serverEnvironment: { MCP_AUTH_TOKEN: 'server-secret' },
    baseEnvironment: {},
  });
  assert.deepEqual(launch.args, ['C:\\app\\resources\\builder\\server.js']);
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(launch.env.MCP_AUTH_TOKEN, 'server-secret');
  assert.equal(launch.env.BUILDER_INTAKE_WORKER.endsWith('intake-worker.mjs'), true);
  assert.equal(launch.env.BUILDER_BUILD_WORKER.endsWith('build-worker.mjs'), true);
  assert.equal(launch.args.join(' ').includes('server-secret'), false);
});

test('Computer 2 discovery protects inherited secrets while persistent model selectors override stale process values', async () => {
  const files = new Map([
    ['C:\\computer2\\.env.local', 'MCP_AUTH_TOKEN=file-secret\nBUILDER_DESIGN_MODEL=google/gemma-4-31b-it:free\nNEXT_PUBLIC_TOKEN=leak'],
    ['C:\\computer2\\.env.mcp', 'WINDMILL_URL=http://127.0.0.1\nDOCKER_MCP_GATEWAY_TOKEN=gateway'],
  ]);
  const environment = await discoverComputer2Environment({
    existingEnvironment: { MCP_AUTH_TOKEN: 'inherited-secret', BUILDER_DESIGN_MODEL: 'moonshotai/kimi-k2.6:free' },
    fetchImpl: async () => new Response(JSON.stringify({ baseDirectory: 'C:\\computer2' })),
    readFileImpl: async (path) => files.get(path) ?? Promise.reject(new Error('missing')),
  });
  assert.equal(environment.MCP_AUTH_TOKEN, 'inherited-secret');
  assert.equal(environment.BUILDER_SERVICE_TOKEN, 'inherited-secret');
  assert.equal(environment.BUILDER_DESIGN_MODEL, 'google/gemma-4-31b-it:free');
  assert.equal(environment.WINDMILL_URL, 'http://127.0.0.1');
  assert.equal(environment.NEXT_PUBLIC_TOKEN, undefined);
});

test('desktop directory setup migrates existing SQLite state on first launch', () => {
  const root = tempRoot('builder-desktop-state-');
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
    assert.equal(existsSync(paths.logDirectory), true);
    assert.equal(existsSync(paths.projectsRoot), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Electron entry reports a secure native configuration without secrets', () => {
  const main = readFileSync(join(projectRoot, 'desktop', 'main.mjs'), 'utf8');
  const options = secureWindowOptions();
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /rendererCredentials:\s*false/);
  assert.doesNotMatch(main, /OPENROUTER_API_KEY\s*[:=]\s*['"][^'"]+/);
});

test('desktop exposes a sandboxed native repository folder picker', () => {
  const main = readFileSync(join(projectRoot, 'desktop', 'main.mjs'), 'utf8');
  const preload = readFileSync(join(projectRoot, 'desktop', 'preload.cjs'), 'utf8');
  assert.match(main, /builder:select-repository-root/);
  assert.match(main, /properties:\s*\['openDirectory'\]/);
  assert.match(preload, /selectRepositoryRoot/);
  assert.equal(secureWindowOptions().webPreferences.sandbox, true);
});

test('staging copies standalone static assets and rejects secret-bearing file types', () => {
  const root = tempRoot('builder-desktop-stage-');
  try {
    const standalone = join(root, 'standalone');
    const staticDirectory = join(root, 'static');
    const publicDirectory = join(root, 'public');
    mkdirSync(standalone, { recursive: true });
    mkdirSync(staticDirectory, { recursive: true });
    mkdirSync(publicDirectory, { recursive: true });
    writeFileSync(join(standalone, 'server.js'), 'console.log("ok")');
    writeFileSync(join(staticDirectory, 'asset.txt'), 'static');
    writeFileSync(join(publicDirectory, 'public.txt'), 'public');
    const report = prepareDesktopBundle({ standaloneDirectory: standalone, staticDirectory, publicDirectory });
    assert.equal(report.serverPath, join(standalone, 'server.js'));
    assert.equal(readFileSync(join(standalone, '.next_build', 'static', 'asset.txt'), 'utf8'), 'static');
    assert.equal(existsSync(join(standalone, '.next', 'static', 'asset.txt')), false);
    assert.equal(readFileSync(join(standalone, 'public', 'public.txt'), 'utf8'), 'public');
    writeFileSync(join(standalone, '.env'), 'SECRET=value');
    assert.throws(() => validateDesktopBundle(standalone), /Forbidden packaged file/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('packaged resource verifier follows the custom Next.js dist directory', () => {
  const root = tempRoot('builder-package-verify-');
  try {
    mkdirSync(join(root, 'builder', 'node_modules', 'next'), { recursive: true });
    mkdirSync(join(root, 'builder', '.next_build', 'static'), { recursive: true });
    mkdirSync(join(root, 'builder-worker'), { recursive: true });
    writeFileSync(join(root, 'builder', 'server.js'), 'console.log("ok")');
    writeFileSync(join(root, 'builder', 'node_modules', 'next', 'package.json'), '{}');
    writeFileSync(join(root, 'builder', '.next_build', 'static', 'asset.js'), 'static');
    writeFileSync(join(root, 'builder-worker', 'intake-worker.mjs'), '');
    writeFileSync(join(root, 'builder-worker', 'build-worker.mjs'), '');
    assert.equal(verifyDesktopPackage(root).requiredPaths, 5);
    assert.equal(existsSync(join(root, 'builder', '.next', 'static')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('desktop packaging contract creates NSIS desktop and Start Menu shortcuts', () => {
  const config = loadDesktopBuilderConfig(join(projectRoot, 'desktop-builder.yml'));
  assert.equal(config.win.target, 'nsis');
  assert.equal(config.nsis.createDesktopShortcut, true);
  assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.nsis.shortcutName, 'Autonomous Project Builder');
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
});

test('intake worker build carries the PDF worker and standard fonts needed outside node_modules', () => {
  execFileSync(nodeExecutable, [join(projectRoot, 'scripts', 'build-intake-worker.mjs')], { cwd: projectRoot, stdio: 'pipe' });
  assert.equal(existsSync(join(projectRoot, 'dist-worker', 'intake-worker.mjs')), true);
  assert.equal(existsSync(join(projectRoot, 'dist-worker', 'build-worker.mjs')), true);
  assert.equal(existsSync(join(projectRoot, 'dist-worker', 'pdf.worker.mjs')), true);
  assert.equal(existsSync(join(projectRoot, 'dist-worker', 'standard_fonts')), true);
});

test('desktop paths resolve the packaged intake worker outside writable project state', () => {
  const paths = resolveDesktopPaths({
    isPackaged: true,
    resourcesPath: 'C:\\Program Files\\Builder\\resources',
    userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\builder',
    cwd: 'C:\\source',
    homeDirectory: 'C:\\Users\\test',
  });
  assert.equal(paths.intakeWorker, join('C:\\Program Files\\Builder\\resources', 'builder-worker', 'intake-worker.mjs'));
  assert.equal(paths.buildWorker, join('C:\\Program Files\\Builder\\resources', 'builder-worker', 'build-worker.mjs'));
  assert.equal(paths.intakeWorker.includes(paths.userDataPath), false);
});

test('TypeScript excludes generated desktop release output from repeat builds', () => {
  const config = JSON.parse(readFileSync(join(projectRoot, 'tsconfig.json'), 'utf8'));
  for (const directory of ['dist-desktop', 'dist-desktop-fixed', 'dist-release-*', 'dist-worker', 'output', 'build']) {
    assert.equal(config.exclude.includes(directory), true, `${directory} should be excluded`);
  }
});

test('ESLint ignores generated desktop release output', () => {
  const config = readFileSync(join(projectRoot, 'eslint.config.mjs'), 'utf8');
  assert.match(config, /dist-desktop\*\/\*\*/);
  assert.match(config, /dist-worker\/\*\*/);
  assert.match(config, /\.next\/\*\*/);
});

test('desktop packaging generates a dedicated 512px application icon', async () => {
  const root = tempRoot('builder-icon-');
  try {
    const output = join(root, 'desktop-icon.png');
    const result = await generateDesktopIcon({ source: join(projectRoot, 'src', 'app', 'icon.svg'), output });
    assert.deepEqual(result, { width: 512, height: 512, format: 'png' });
    assert.equal(existsSync(output), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('desktop install helper resolves exactly one generated setup executable', () => {
  if (process.platform !== 'win32') return;
  const root = tempRoot('builder-installer-one-');
  try {
    const installer = join(root, 'Autonomous-Project-Builder-Setup-1.0.0.exe');
    writeFileSync(installer, 'fixture');
    const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(projectRoot, 'scripts', 'install-desktop.ps1'), '-OutputDirectory', root, '-ValidateOnly'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Autonomous-Project-Builder-Setup-1\.0\.0\.exe/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('desktop install helper rejects ambiguous setup artifacts', () => {
  if (process.platform !== 'win32') return;
  const root = tempRoot('builder-installer-many-');
  try {
    writeFileSync(join(root, 'Autonomous-Project-Builder-Setup-1.0.0.exe'), 'one');
    writeFileSync(join(root, 'Autonomous-Project-Builder-Setup-1.0.1.exe'), 'two');
    const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(projectRoot, 'scripts', 'install-desktop.ps1'), '-OutputDirectory', root, '-ValidateOnly'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Expected exactly one/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});



test('desktop exposes native required-input folder/file pickers without renderer filesystem privileges', () => {
  const main = readFileSync(join(projectRoot, 'desktop', 'main.mjs'), 'utf8');
  const preload = readFileSync(join(projectRoot, 'desktop', 'preload.cjs'), 'utf8');
  assert.match(main, /builder:select-input-folder/);
  assert.match(main, /builder:select-input-files/);
  assert.match(main, /multiSelections/);
  assert.match(preload, /selectInputFolder/);
  assert.match(preload, /selectInputFiles/);
  assert.equal(secureWindowOptions().webPreferences.nodeIntegration, false);
  assert.equal(secureWindowOptions().webPreferences.sandbox, true);
});

test('desktop keeps reusable credential vault in persistent user state and passes only its path to the server', () => {
  const paths = resolveDesktopPaths({
    isPackaged: true,
    resourcesPath: 'C:\Program Files\Builder\resources',
    userDataPath: 'C:\Users\test\AppData\Roaming\builder',
    cwd: 'C:\source',
    homeDirectory: 'C:\Users\test',
  });
  assert.equal(paths.secretVault, join('C:\Users\test\AppData\Roaming\builder', 'state', 'secure-credentials.json'));
  const launch = buildServerLaunch({
    electronExecutable: 'Builder.exe', serverPath: 'C:\app\server.js', origin: 'http://127.0.0.1:3107',
    stateDb: paths.stateDb, projectsRoot: paths.projectsRoot, secretVault: paths.secretVault,
    intakeWorker: 'C:\worker\intake-worker.mjs', buildWorker: 'C:\worker\build-worker.mjs', baseEnvironment: {},
  });
  assert.equal(launch.env.BUILDER_SECRET_VAULT, paths.secretVault);
  assert.equal(launch.args.join(' ').includes('secure-credentials.json'), false);
});

test('desktop discovers the Groq visual fallback without exposing renderer privileges', () => {
  const runtime = readFileSync('desktop/runtime.mjs', 'utf8');
  assert.match(runtime, /'GROQ_API_KEY'/);
  assert.match(runtime, /'GROQ_VISION_MODEL'/);
});
