import { IntakeStore } from '../src/lib/intake/store.ts';
import { runIntakeWorker } from '../src/lib/intake/worker.ts';
import { existsSync } from 'node:fs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

if (process.argv.includes('--validate')) {
  process.stdout.write(JSON.stringify({ ok: true, worker: 'autonomous-builder-intake' }));
  process.exit(0);
}

const databasePath = argument('--database');
const intakeId = argument('--intake');
const pdfRendererPath = argument('--pdf-renderer');
if (!databasePath || !intakeId) {
  process.stderr.write('Usage: intake-worker.mjs --database <path> --intake <id> [--pdf-renderer <path>]\n');
  process.exit(2);
}
if (pdfRendererPath) {
  if (!existsSync(pdfRendererPath)) {
    process.stderr.write(`Configured PDF renderer does not exist: ${pdfRendererPath}\n`);
    process.exit(2);
  }
  process.env.PDF_RENDERER_PATH = pdfRendererPath;
}

const store = new IntakeStore(databasePath);
try {
  const result = await runIntakeWorker({ store, intakeId });
  process.stdout.write(JSON.stringify({ ok: true, briefId: result.id, version: result.version }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  store.close();
}
