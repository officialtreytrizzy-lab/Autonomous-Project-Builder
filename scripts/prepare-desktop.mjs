import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FORBIDDEN_FILE = /(^\.env(?:\.|$)|\.(?:db|sqlite|sqlite3|log)$|^cookies\.json$)/i;
const FORBIDDEN_PATH = /(?:^|[\\/])(?:intake[\\/](?:originals|derived|evidence)|\.ollama|models[\\/]blobs)(?:[\\/]|$)|^[\\/](?:dist-desktop(?:-fixed)?|dist-worker|output|build)(?:[\\/]|$)/i;

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

export function validateDesktopBundle(standaloneDirectory) {
  const root = resolve(standaloneDirectory);
  const serverPath = join(root, 'server.js');
  if (!existsSync(serverPath) || !statSync(serverPath).isFile()) {
    throw new Error(`Standalone Builder server is missing: ${serverPath}`);
  }
  for (const file of walk(root)) {
    if (FORBIDDEN_FILE.test(basename(file)) || FORBIDDEN_PATH.test(file.slice(root.length))) {
      throw new Error(`Forbidden packaged file: ${file}`);
    }
  }
  return { root, serverPath, fileCount: walk(root).length };
}

export function prepareDesktopBundle({ standaloneDirectory, staticDirectory, publicDirectory }) {
  const standalone = resolve(standaloneDirectory);
  if (!existsSync(join(standalone, 'server.js'))) {
    throw new Error(`Run the Next production build first; server.js is missing from ${standalone}.`);
  }
  if (!existsSync(staticDirectory)) throw new Error(`Next static assets are missing: ${staticDirectory}`);
  for (const generatedState of ['.builder', '.vercel', '.git', 'tsconfig.tsbuildinfo', 'tmp', 'temp', 'output', 'dist-desktop', 'dist-desktop-fixed', 'dist-worker', 'build']) {
    rmSync(join(standalone, generatedState), { recursive: true, force: true });
  }
  // The standalone server inherits Next's custom distDir (.next_build), so static assets must live under that same directory.
  // Keeping them under .next/static makes the UI render as raw, unstyled HTML in the packaged Electron app.
  rmSync(join(standalone, '.next'), { recursive: true, force: true });
  const staticTarget = join(standalone, '.next_build', 'static');
  mkdirSync(staticTarget, { recursive: true });
  cpSync(staticDirectory, staticTarget, { recursive: true, force: true });
  if (publicDirectory && existsSync(publicDirectory)) {
    const publicTarget = join(standalone, 'public');
    mkdirSync(publicTarget, { recursive: true });
    cpSync(publicDirectory, publicTarget, { recursive: true, force: true });
  }
  return validateDesktopBundle(standalone);
}

export function loadDesktopBuilderConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd();
  const distDir = '.next_build';
  const report = prepareDesktopBundle({
    standaloneDirectory: join(root, distDir, 'standalone'),
    staticDirectory: join(root, distDir, 'static'),
    publicDirectory: join(root, 'public'),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
