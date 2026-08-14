import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareDesktopBundle, validateDesktopBundle } from '../scripts/prepare-desktop.mjs';

test('desktop staging purges traced runtime and E2E state before package validation', () => {
  const root = mkdtempSync(join(tmpdir(), 'builder-desktop-traced-state-'));
  try {
    const standaloneDirectory = join(root, 'standalone');
    const staticDirectory = join(root, 'static');
    mkdirSync(join(standaloneDirectory, 'tmp', 'e2e-projects', 'fixture', 'intake', 'derived'), { recursive: true });
    mkdirSync(join(standaloneDirectory, 'output', 'playwright'), { recursive: true });
    mkdirSync(staticDirectory, { recursive: true });
    writeFileSync(join(standaloneDirectory, 'server.js'), 'server');
    writeFileSync(join(standaloneDirectory, 'tmp', 'e2e-projects', 'fixture', 'intake', 'derived', 'page.png'), 'private-derived-evidence');
    writeFileSync(join(standaloneDirectory, 'output', 'playwright', 'trace.zip'), 'test-trace');
    writeFileSync(join(staticDirectory, 'chunk.js'), 'chunk');

    prepareDesktopBundle({ standaloneDirectory, staticDirectory });
    assert.equal(existsSync(join(standaloneDirectory, 'tmp')), false);
    assert.equal(existsSync(join(standaloneDirectory, 'output')), false);
    assert.doesNotThrow(() => validateDesktopBundle(standaloneDirectory));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});