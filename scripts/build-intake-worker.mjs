import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const outputDirectory = resolve('dist-worker');
rmSync(outputDirectory, { recursive: true, force: true });
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


await build({
  entryPoints: [resolve('workers/build-worker.mjs')],
  outfile: resolve(outputDirectory, 'build-worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none',
});
copyFileSync(
  resolve('node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'),
  resolve(outputDirectory, 'pdf.worker.mjs'),
);
cpSync(
  resolve('node_modules', 'pdfjs-dist', 'standard_fonts'),
  resolve(outputDirectory, 'standard_fonts'),
  { recursive: true },
);
