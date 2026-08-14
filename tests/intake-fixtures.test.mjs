import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import mammoth from 'mammoth';
import { PDFDocument } from 'pdf-lib';

const fixtureRoot = join(process.cwd(), 'tests', 'fixtures', 'intake');

test('fixture generator creates real PDF and DOCX multimodal evidence', async () => {
  execFileSync(process.execPath, [join('tests', 'fixtures', 'create-intake-fixtures.mjs')], { cwd: process.cwd() });
  const expected = [
    'ui-requirements.pdf', 'scanned-requirements.pdf', 'restaurant-flow.pdf',
    'product-brief.docx', 'conflict-brief.pdf',
  ];
  for (const filename of expected) assert.equal(existsSync(join(fixtureRoot, filename)), true, filename);

  const uiPdf = await PDFDocument.load(readFileSync(join(fixtureRoot, 'ui-requirements.pdf')));
  const scanPdf = await PDFDocument.load(readFileSync(join(fixtureRoot, 'scanned-requirements.pdf')));
  const flowPdf = await PDFDocument.load(readFileSync(join(fixtureRoot, 'restaurant-flow.pdf')));
  const conflictPdf = await PDFDocument.load(readFileSync(join(fixtureRoot, 'conflict-brief.pdf')));
  assert.equal(uiPdf.getPageCount(), 2);
  assert.equal(scanPdf.getPageCount(), 2);
  assert.equal(flowPdf.getPageCount(), 2);
  assert.equal(conflictPdf.getPageCount(), 2);

  const docxText = await mammoth.extractRawText({ path: join(fixtureRoot, 'product-brief.docx') });
  assert.match(docxText.value, /LOCAL MULTIMODAL PASS/);
  assert.match(docxText.value, /private local runtime/i);
});
