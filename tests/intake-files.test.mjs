import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  normalizeSourceFilename,
  replaceSource,
  storeSource,
  tombstoneStoredSource,
  validateSource,
} from '../src/lib/intake/files.ts';
import { IntakeStore } from '../src/lib/intake/store.ts';

const pdfOne = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const pdfTwo = Buffer.from('%PDF-1.7\n1 0 obj\n<</Type /Catalog>>\nendobj\n%%EOF');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'builder-intake-files-'));
  const workspace = join(root, 'project');
  const store = new IntakeStore(join(root, 'state.db'));
  const project = store.createProject({ name: 'Private Brief', objective: 'Build from evidence', workspace });
  const intake = store.createIntake(project.id);
  return {
    root,
    workspace,
    store,
    intake,
    cleanup() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('source storage rejects traversal and MIME spoofing', async () => {
  assert.equal(normalizeSourceFilename('..\\..\\brief.pdf'), 'brief.pdf');
  assert.equal(normalizeSourceFilename('../../my brief?.PDF'), 'my-brief.pdf');
  await assert.rejects(() => validateSource(Buffer.from('not a pdf'), 'brief.pdf'), /signature does not match/i);
  await assert.rejects(() => validateSource(pdfOne, 'brief.exe'), /not supported/i);
});

test('source storage is streamed, private, hashed, and keeps immutable replacement revisions', async (t) => {
  const f = fixture();
  t.after(() => f.cleanup());

  const first = await storeSource(Readable.from(pdfOne), {
    filename: '..\\flow.pdf',
    intakeId: f.intake.id,
    projectWorkspace: f.workspace,
    store: f.store,
  });
  assert.equal('localPath' in first, false);
  assert.equal(first.revision, 1);
  assert.equal(first.normalizedFilename, 'flow.pdf');

  const firstStored = f.store.listSourceRevisions(f.intake.id)[0];
  assert.equal(existsSync(firstStored.localPath), true);
  assert.deepEqual(readFileSync(firstStored.localPath), pdfOne);
  assert.match(firstStored.localPath, /\.builder[\\/]intake-data[\\/]originals/);

  const second = await replaceSource(first.sourceId, Readable.from(pdfTwo), {
    filename: 'flow.pdf',
    intakeId: f.intake.id,
    projectWorkspace: f.workspace,
    store: f.store,
  });
  const revisions = f.store.listSourceRevisions(f.intake.id);
  assert.equal(second.revision, 2);
  assert.equal(revisions.length, 2);
  assert.notEqual(revisions[0].localPath, revisions[1].localPath);
  assert.equal(existsSync(revisions[0].localPath), true);
  assert.equal(existsSync(revisions[1].localPath), true);
});

test('delete removes retained bytes but keeps traceable source metadata', async (t) => {
  const f = fixture();
  t.after(() => f.cleanup());
  const source = await storeSource(Readable.from(pdfOne), {
    filename: 'requirements.pdf',
    intakeId: f.intake.id,
    projectWorkspace: f.workspace,
    store: f.store,
  });
  const stored = f.store.listSourceRevisions(f.intake.id)[0];
  const deleted = await tombstoneStoredSource(source.sourceId, f.store);
  assert.equal(deleted.availability, 'deleted');
  assert.equal(existsSync(stored.localPath), false);
  assert.equal(f.store.listSourceRevisions(f.intake.id)[0].originalFilename, 'requirements.pdf');
});

test('intake source count and per-source byte limits are enforced', async (t) => {
  const f = fixture();
  t.after(() => f.cleanup());
  for (let index = 0; index < 20; index += 1) {
    await storeSource(Readable.from(Buffer.from(`note ${index}`)), {
      filename: `note-${index}.txt`,
      intakeId: f.intake.id,
      projectWorkspace: f.workspace,
      store: f.store,
    });
  }
  await assert.rejects(
    () => storeSource(Readable.from(Buffer.from('extra')), {
      filename: 'extra.txt', intakeId: f.intake.id, projectWorkspace: f.workspace, store: f.store,
    }),
    /20 sources/i,
  );

  const smallLimit = fixture();
  t.after(() => smallLimit.cleanup());
  await assert.rejects(
    () => storeSource(Readable.from(Buffer.alloc(9, 1)), {
      filename: 'large.txt', intakeId: smallLimit.intake.id, projectWorkspace: smallLimit.workspace,
      store: smallLimit.store, maxBytes: 8,
    }),
    /exceeds.*8 bytes/i,
  );
});

test('legacy DOC browser MIME is accepted when the file has a real compound-file signature', async () => {
  const doc = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(doc);
  const detected = await validateSource(doc, 'implementation.doc', 'application/msword');
  assert.equal(detected.mime, 'application/x-cfb');
});
