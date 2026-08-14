import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractDocument, needsOcr, processDocument } from '../src/lib/intake/documents.ts';

const pdfFixture = {
  sourceId: 'source-pdf',
  revisionId: 'revision-pdf-1',
  revision: 1,
  intakeId: 'intake-1',
  contentHash: 'abc',
  mimeType: 'application/pdf',
  originalFilename: 'Restaurant Flow.pdf',
  normalizedFilename: 'Restaurant-Flow.pdf',
  size: 10,
  ingestedAt: '2026-08-13T00:00:00.000Z',
  availability: 'available',
  processingStatus: 'stored',
  localPath: 'fixture.pdf',
};

function fakeDocumentDeps(options = {}) {
  const pages = options.pages || [
    { page: 1, nativeText: 'Checkout requirements', imagePath: 'p1.png' },
    { page: 2, nativeText: '', imagePath: 'p2.png' },
  ];
  const calls = options.calls || [];
  return {
    async extract() {
      return { source: pdfFixture, kind: 'pdf', nativeText: pages.map((page) => page.nativeText).join('\n'), pageCount: pages.length };
    },
    async render() { return pages; },
    async ocr(page) {
      calls.push({ kind: 'ocr', page: page.page });
      return `Recovered text from page ${page.page}`;
    },
    async inspect(page) {
      calls.push({ kind: 'vision', page: page.page });
      if (page.page === options.failVisionPage) throw new Error('controlled vision failure');
      return {
        pageSummary: page.page === 1 ? 'A checkout flow with a confirmation step.' : 'A sketched mobile order screen.',
        meaningfulVisuals: [{
          kind: page.page === 1 ? 'diagram' : 'ui',
          description: page.page === 1 ? 'Checkout leads to confirmation.' : 'Mobile ordering layout.',
          relationships: ['checkout before confirmation'],
          confidence: 0.94,
        }],
        uncertainties: [],
      };
    },
  };
}

test('every PDF page is inspected while OCR remains conditional', async () => {
  const calls = [];
  const result = await processDocument(pdfFixture, fakeDocumentDeps({ calls }));
  assert.deepEqual(calls.filter((entry) => entry.kind === 'vision').map((entry) => entry.page), [1, 2]);
  assert.deepEqual(calls.filter((entry) => entry.kind === 'ocr').map((entry) => entry.page), [2]);
  assert.equal(result.visualCoverage.complete, true);
  assert.deepEqual(result.visualCoverage, { inspectedPages: 2, totalPages: 2, complete: true });
});

test('text and visual findings are retained as equal source-linked evidence', async () => {
  const result = await processDocument(pdfFixture, fakeDocumentDeps());
  const pageOne = result.evidence.filter((item) => item.page === 1);
  assert.equal(pageOne.some((item) => item.kind === 'native-text' && item.content.includes('Checkout requirements')), true);
  assert.equal(pageOne.some((item) => item.kind === 'diagram' && item.content.includes('Checkout leads')), true);
  assert.equal(pageOne.every((item) => item.sourceId === pdfFixture.sourceId && item.revisionId === pdfFixture.revisionId), true);
});

test('an uninspected page blocks brief approval without discarding inspected evidence', async () => {
  const result = await processDocument(pdfFixture, fakeDocumentDeps({ failVisionPage: 2 }));
  assert.equal(result.visualCoverage.complete, false);
  assert.deepEqual(result.visualCoverage, { inspectedPages: 1, totalPages: 2, complete: false });
  assert.equal(result.blockingIssues[0].code, 'page_visual_inspection_incomplete');
  assert.equal(result.blockingIssues[0].page, 2);
  assert.equal(result.evidence.some((item) => item.page === 1 && item.kind === 'diagram'), true);
});

test('OCR is requested only for pages without useful native text', () => {
  assert.equal(needsOcr({ page: 1, nativeText: 'A readable paragraph describing the complete flow.', imagePath: 'p1.png' }), false);
  assert.equal(needsOcr({ page: 2, nativeText: ' ', imagePath: 'p2.png' }), true);
  assert.equal(needsOcr({ page: 3, nativeText: '\u0000\u0000', imagePath: 'p3.png' }), true);
});

test('DOCX retry reuses its retained fixed-layout PDF instead of relaunching Word', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'intake-docx-retry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const originals = join(root, 'intake', 'originals');
  mkdirSync(originals, { recursive: true });
  const localPath = join(originals, 'product-brief.docx');
  copyFileSync(join(process.cwd(), 'tests', 'fixtures', 'intake', 'product-brief.docx'), localPath);
  let conversions = 0;
  const source = {
    ...pdfFixture,
    sourceId: 'source-docx', revisionId: 'revision-docx-1', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    originalFilename: 'product-brief.docx', normalizedFilename: 'product-brief.docx', localPath, size: statSync(localPath).size,
  };
  const deps = {
    async convertWordToPdf(_sourcePath, outputPath) {
      conversions += 1;
      copyFileSync(join(process.cwd(), 'tests', 'fixtures', 'intake', 'ui-requirements.pdf'), outputPath);
    },
  };

  await extractDocument(source, deps);
  await extractDocument(source, deps);

  assert.equal(conversions, 1);
});
