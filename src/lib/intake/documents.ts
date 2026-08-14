import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import mammoth from 'mammoth';

import type { EvidenceRecord } from './types.ts';
import type { StoredSourceManifestItem } from './store.ts';
import { inspectPage as inspectVisualPage, type PageVisualResult, type VisionClient } from './vision.ts';

const execFile = promisify(execFileCallback);

export type ExtractedDocument = {
  source: StoredSourceManifestItem;
  kind: 'pdf' | 'word' | 'text' | 'image';
  nativeText: string;
  pageNativeText: string[];
  pageCount: number;
  embeddedImages: string[];
  renderSourcePath: string;
};

export type RenderedPage = { page: number; nativeText: string; imagePath: string };

type ExtractDependencies = {
  convertWordToPdf?: (sourcePath: string, outputPath: string) => Promise<void>;
};

type RenderDependencies = ExtractDependencies & {
  pdfRendererPath?: string;
};

type ProcessDependencies = {
  extract?: (source: StoredSourceManifestItem) => Promise<ExtractedDocument>;
  render?: (document: ExtractedDocument) => Promise<RenderedPage[]>;
  ocr?: (page: RenderedPage) => Promise<string>;
  inspect?: (page: RenderedPage, requestOcr: boolean) => Promise<PageVisualResult>;
  visionClient?: VisionClient;
  renderDependencies?: RenderDependencies;
  completedPages?: Set<number>;
};

function intakeRoot(source: StoredSourceManifestItem) {
  return dirname(dirname(source.localPath));
}

function derivedRevisionPath(source: StoredSourceManifestItem) {
  return join(intakeRoot(source), 'derived', source.sourceId, `r${source.revision}`);
}

async function extractPdf(source: StoredSourceManifestItem) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const packagedFonts = join(moduleDirectory, 'standard_fonts');
  const standardFonts = existsSync(packagedFonts)
    ? packagedFonts
    : join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts');
  const packagedWorker = join(moduleDirectory, 'pdf.worker.mjs');
  if (existsSync(packagedWorker)) pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(packagedWorker).href;
  const standardFontDataUrl = `${pathToFileURL(standardFonts).href}/`;
  const loading = pdfjs.getDocument({ data: new Uint8Array(readFileSync(source.localPath)), standardFontDataUrl, useSystemFonts: true });
  const pdf = await loading.promise;
  const pageNativeText: string[] = [];
  try {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pageNativeText.push(content.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' ').replace(/\s+/g, ' ').trim());
    }
  } finally {
    await loading.destroy();
  }
  return { pageNativeText, pageCount: pageNativeText.length, nativeText: pageNativeText.join('\n\n') };
}

async function extractDocx(source: StoredSourceManifestItem) {
  const result = await mammoth.extractRawText({ path: source.localPath });
  const embeddedDirectory = join(derivedRevisionPath(source), 'embedded');
  mkdirSync(embeddedDirectory, { recursive: true });
  const embeddedImages: string[] = [];
  await mammoth.convertToHtml(
    { path: source.localPath },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const extension = image.contentType.split('/').at(-1)?.replace('jpeg', 'jpg') || 'bin';
        const path = join(embeddedDirectory, `image-${embeddedImages.length + 1}.${extension}`);
        writeFileSync(path, Buffer.from(await image.read('base64'), 'base64'));
        embeddedImages.push(path);
        return { src: path };
      }),
    },
  );
  return { nativeText: result.value.trim(), embeddedImages };
}

async function convertWordToPdf(sourcePath: string, outputPath: string) {
  const script = [
    "$word = New-Object -ComObject Word.Application",
    '$word.Visible = $false',
    `$doc = $word.Documents.Open('${sourcePath.replaceAll("'", "''")}')`,
    `$doc.SaveAs([ref]'${outputPath.replaceAll("'", "''")}', [ref]17)`,
    '$doc.Close()',
    '$word.Quit()',
  ].join('; ');
  await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 120_000 });
}

export async function extractDocument(source: StoredSourceManifestItem, deps: ExtractDependencies = {}): Promise<ExtractedDocument> {
  const extension = extname(source.normalizedFilename).toLowerCase();
  if (extension === '.pdf') {
    const extracted = await extractPdf(source);
    return { source, kind: 'pdf', ...extracted, embeddedImages: [], renderSourcePath: source.localPath };
  }
  if (extension === '.docx' || extension === '.doc') {
    const extracted = extension === '.docx' ? await extractDocx(source) : { nativeText: '', embeddedImages: [] };
    const outputDirectory = derivedRevisionPath(source);
    mkdirSync(outputDirectory, { recursive: true });
    const pdfPath = join(outputDirectory, 'fixed-layout.pdf');
    if (!existsSync(pdfPath)) await (deps.convertWordToPdf || convertWordToPdf)(source.localPath, pdfPath);
    const pdfSource = { ...source, localPath: pdfPath, normalizedFilename: 'fixed-layout.pdf' };
    const pages = await extractPdf(pdfSource);
    return {
      source,
      kind: 'word',
      nativeText: extracted.nativeText || pages.nativeText,
      pageNativeText: pages.pageNativeText,
      pageCount: pages.pageCount,
      embeddedImages: extracted.embeddedImages,
      renderSourcePath: pdfPath,
    };
  }
  if (['.txt', '.md'].includes(extension)) {
    const nativeText = readFileSync(source.localPath, 'utf8');
    return { source, kind: 'text', nativeText, pageNativeText: [], pageCount: 0, embeddedImages: [], renderSourcePath: source.localPath };
  }
  return { source, kind: 'image', nativeText: '', pageNativeText: [''], pageCount: 1, embeddedImages: [], renderSourcePath: source.localPath };
}

function numericPage(path: string) {
  const match = path.match(/-(\d+)\.png$/i);
  return match ? Number(match[1]) : 0;
}

export async function renderPages(document: ExtractedDocument, deps: RenderDependencies = {}): Promise<RenderedPage[]> {
  if (document.kind === 'text') return [];
  if (document.kind === 'image') return [{ page: 1, nativeText: '', imagePath: document.source.localPath }];
  const pageDirectory = join(derivedRevisionPath(document.source), 'pages');
  mkdirSync(pageDirectory, { recursive: true });
  const renderer = deps.pdfRendererPath || process.env.PDF_RENDERER_PATH?.trim() || 'pdftoppm';
  const prefix = join(pageDirectory, 'page');
  await execFile(renderer, ['-png', '-r', '150', document.renderSourcePath, prefix], { windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024 });
  return readdirSync(pageDirectory)
    .filter((name) => /^page-\d+\.png$/i.test(name))
    .map((name) => join(pageDirectory, name))
    .sort((left, right) => numericPage(left) - numericPage(right))
    .map((imagePath, index) => ({ page: index + 1, nativeText: document.pageNativeText[index] || '', imagePath }));
}

export function needsOcr(page: Pick<RenderedPage, 'nativeText'>) {
  const text = page.nativeText.replaceAll('\u0000', '').replace(/\s+/g, ' ').trim();
  return text.length < 12;
}

function evidenceBase(source: StoredSourceManifestItem, page: number) {
  return {
    evidenceId: `evidence-${randomUUID()}`,
    intakeId: source.intakeId,
    sourceId: source.sourceId,
    revisionId: source.revisionId,
    page,
    createdAt: new Date().toISOString(),
  };
}

export async function processDocument(source: StoredSourceManifestItem, deps: ProcessDependencies = {}) {
  const document = await (deps.extract || ((item) => extractDocument(item)))(source);
  const pages = await (deps.render || ((item) => renderPages(item, deps.renderDependencies)))(document);
  const evidence: EvidenceRecord[] = [];
  const blockingIssues: Array<{ code: string; page: number; message: string }> = [];
  let inspectedPages = 0;

  for (const page of pages) {
    if (deps.completedPages?.has(page.page)) {
      inspectedPages += 1;
      continue;
    }
    const base = evidenceBase(source, page.page);
    if (page.nativeText.trim()) {
      evidence.push({ ...base, kind: 'native-text', content: page.nativeText, relationships: [], confidence: 1, processingMethod: 'native-extraction' });
    }
    const requestOcr = needsOcr(page);
    try {
      const ocrText = requestOcr && deps.ocr ? await deps.ocr(page) : '';
      if (ocrText.trim()) {
        evidence.push({ ...evidenceBase(source, page.page), kind: 'ocr-text', content: ocrText, relationships: [], confidence: 0.9, processingMethod: 'conditional-local-ocr' });
      }
      const visual = deps.inspect
        ? await deps.inspect(page, requestOcr)
        : await inspectVisualPage(page, deps.visionClient!, requestOcr);
      inspectedPages += 1;
      evidence.push({
        ...evidenceBase(source, page.page),
        kind: 'page-overview',
        content: visual.pageSummary,
        relationships: visual.uncertainties,
        confidence: visual.uncertainties.length ? 0.75 : 0.95,
        processingMethod: 'local-vision',
        artifactPath: page.imagePath,
      });
      if (!ocrText.trim() && requestOcr && visual.ocrText?.trim()) {
        evidence.push({ ...evidenceBase(source, page.page), kind: 'ocr-text', content: visual.ocrText, relationships: [], confidence: 0.9, processingMethod: 'local-vision-ocr' });
      }
      for (const finding of visual.meaningfulVisuals) {
        evidence.push({
          ...evidenceBase(source, page.page),
          kind: finding.kind,
          content: finding.description,
          relationships: finding.relationships,
          confidence: finding.confidence,
          ...(finding.region ? { region: finding.region } : {}),
          processingMethod: 'local-vision',
          artifactPath: page.imagePath,
        });
      }
    } catch (error) {
      blockingIssues.push({
        code: 'page_visual_inspection_incomplete',
        page: page.page,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (document.kind === 'text' && document.nativeText.trim()) {
    evidence.push({ ...evidenceBase(source, 1), kind: 'native-text', content: document.nativeText, relationships: [], confidence: 1, processingMethod: 'native-extraction' });
  }
  const totalPages = pages.length;
  return {
    document,
    evidence,
    visualCoverage: { inspectedPages, totalPages, complete: inspectedPages === totalPages },
    blockingIssues,
  };
}

export { inspectVisualPage as inspectPage };
