import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const outputDirectory = resolve('dist-worker');
mkdirSync(outputDirectory, { recursive: true });

await build({
  entryPoints: [resolve('workers/intake-worker.mjs')],
  outfile: resolve(outputDirectory, 'intake-worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none',
  external: ['canvas', 'path2d-polyfill'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
