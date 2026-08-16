import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_PACKAGE_PATHS = [
  ['builder', 'server.js'],
  ['builder', 'node_modules', 'next', 'package.json'],
  ['builder', '.next', 'static'],
  ['builder-worker', 'intake-worker.mjs'],
  ['builder-worker', 'build-worker.mjs'],
];

export function verifyDesktopPackage(resourcesDirectory) {
  const root = resolve(resourcesDirectory);
  const missing = REQUIRED_PACKAGE_PATHS
    .map((parts) => join(root, ...parts))
    .filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(`Desktop package is missing required runtime resources:\n${missing.join('\n')}`);
  }
  return { resourcesDirectory: root, requiredPaths: REQUIRED_PACKAGE_PATHS.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const resourcesDirectory = join(process.cwd(), 'dist-desktop', 'win-unpacked', 'resources');
  process.stdout.write(`${JSON.stringify(verifyDesktopPackage(resourcesDirectory))}\n`);
}
