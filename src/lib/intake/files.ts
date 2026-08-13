import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { fileTypeFromBuffer, fileTypeFromFile } from 'file-type';

import type { IntakeStore, StoredSourceManifestItem } from './store.ts';

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const MAX_SOURCES_PER_INTAKE = 20;
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp']);

const EXPECTED_MIME: Record<string, Set<string>> = {
  '.pdf': new Set(['application/pdf']),
  '.doc': new Set(['application/x-cfb']),
  '.docx': new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  '.png': new Set(['image/png']),
  '.jpg': new Set(['image/jpeg']),
  '.jpeg': new Set(['image/jpeg']),
  '.webp': new Set(['image/webp']),
};

type SourceContext = {
  filename: string;
  intakeId: string;
  projectWorkspace: string;
  store: IntakeStore;
  declaredMimeType?: string;
  maxBytes?: number;
};

export type PublicSourceManifestItem = Omit<StoredSourceManifestItem, 'intakeId' | 'localPath'>;

function leafFilename(filename: string) {
  return basename(filename.replaceAll('\\', '/')).normalize('NFKC');
}

export function normalizeSourceFilename(filename: string) {
  const leaf = leafFilename(filename);
  const extension = extname(leaf).toLowerCase();
  const rawStem = leaf.slice(0, Math.max(0, leaf.length - extension.length));
  const stem = rawStem
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100) || 'source';
  return `${stem}${extension}`;
}

function assertSupportedExtension(filename: string) {
  const extension = extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Source type ${extension || '(none)'} is not supported`);
  }
  return extension;
}

function validateDeclaredMime(detectedMime: string, declaredMimeType?: string) {
  if (!declaredMimeType || declaredMimeType === 'application/octet-stream') return;
  if (declaredMimeType !== detectedMime) {
    throw new Error(`Declared MIME ${declaredMimeType} does not match detected signature ${detectedMime}`);
  }
}

function validateText(bytes: Buffer, declaredMimeType?: string) {
  if (bytes.includes(0)) throw new Error('Text source contains a binary signature that does not match its extension');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Text source is not valid UTF-8');
  }
  if (declaredMimeType && !['text/plain', 'text/markdown', 'application/octet-stream'].includes(declaredMimeType)) {
    throw new Error(`Declared MIME ${declaredMimeType} does not match text source`);
  }
  return { ext: 'txt', mime: declaredMimeType === 'text/markdown' ? 'text/markdown' : 'text/plain' };
}

function validateDetectedType(extension: string, detected: { ext: string; mime: string } | undefined, bytes: Buffer, declaredMimeType?: string) {
  if (extension === '.txt' || extension === '.md') {
    if (detected) throw new Error(`Source signature does not match ${extension} extension`);
    return validateText(bytes, declaredMimeType);
  }
  const allowed = EXPECTED_MIME[extension];
  if (!detected || !allowed?.has(detected.mime)) {
    throw new Error(`Source signature does not match ${extension} extension`);
  }
  validateDeclaredMime(detected.mime, declaredMimeType);
  return detected;
}

export async function validateSource(bytes: Buffer, filename: string, declaredMimeType?: string) {
  const normalizedFilename = normalizeSourceFilename(filename);
  const extension = assertSupportedExtension(normalizedFilename);
  const detected = await fileTypeFromBuffer(bytes);
  return validateDetectedType(extension, detected, bytes, declaredMimeType);
}

async function validateStoredFile(path: string, filename: string, declaredMimeType?: string) {
  const extension = assertSupportedExtension(filename);
  const detected = await fileTypeFromFile(path);
  const prefix = readFileSync(path).subarray(0, 64 * 1024);
  return validateDetectedType(extension, detected, prefix, declaredMimeType);
}

function publicMetadata(source: StoredSourceManifestItem): PublicSourceManifestItem {
  const { intakeId: _intakeId, localPath: _localPath, ...publicSource } = source;
  return publicSource;
}

export async function storeSource(stream: NodeJS.ReadableStream, context: SourceContext & { sourceId?: string }) {
  const normalizedFilename = normalizeSourceFilename(context.filename);
  const extension = assertSupportedExtension(normalizedFilename);
  const currentSources = context.store.currentSources(context.intakeId);
  const replacing = Boolean(context.sourceId);
  if (!replacing && currentSources.length >= MAX_SOURCES_PER_INTAKE) {
    throw new Error(`An intake may contain at most ${MAX_SOURCES_PER_INTAKE} sources`);
  }
  if (replacing && !currentSources.some((source) => source.sourceId === context.sourceId)) {
    throw new Error(`Unknown source: ${context.sourceId}`);
  }

  const sourceId = context.sourceId || `source-${randomUUID()}`;
  const previous = currentSources.find((source) => source.sourceId === sourceId);
  const revision = (previous?.revision || 0) + 1;
  const originals = join(context.projectWorkspace, 'intake', 'originals');
  const incoming = join(originals, '.incoming');
  mkdirSync(incoming, { recursive: true });
  mkdirSync(join(context.projectWorkspace, 'intake', 'derived'), { recursive: true });
  mkdirSync(join(context.projectWorkspace, 'intake', 'briefs'), { recursive: true });
  mkdirSync(join(context.projectWorkspace, 'intake', 'evidence'), { recursive: true });
  const temporaryPath = join(incoming, `${randomUUID()}.upload`);
  const destinationPath = join(originals, `${sourceId}-r${revision}${extension}`);
  const hash = createHash('sha256');
  const maxBytes = context.maxBytes ?? DEFAULT_MAX_BYTES;
  let size = 0;

  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(new Error(`Source exceeds the ${maxBytes} bytes limit`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(stream, guard, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
    await validateStoredFile(temporaryPath, normalizedFilename, context.declaredMimeType);
    renameSync(temporaryPath, destinationPath);
    const source = context.store.addSourceRevision(context.intakeId, {
      sourceId,
      contentHash: hash.digest('hex'),
      mimeType: (await validateStoredFile(destinationPath, normalizedFilename, context.declaredMimeType)).mime,
      originalFilename: leafFilename(context.filename),
      normalizedFilename,
      size,
      localPath: destinationPath,
    });
    return publicMetadata(source);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    if (!context.store.listSourceRevisions(context.intakeId).some((item) => item.localPath === destinationPath)) {
      rmSync(destinationPath, { force: true });
    }
    throw error;
  }
}

export function replaceSource(sourceId: string, stream: NodeJS.ReadableStream, context: SourceContext) {
  return storeSource(stream, { ...context, sourceId });
}

export async function tombstoneStoredSource(sourceId: string, store: IntakeStore) {
  const revisions = store.listSourceRevisions(store.tombstoneSource(sourceId).intakeId).filter((source) => source.sourceId === sourceId);
  for (const revision of revisions) rmSync(revision.localPath, { force: true });
  return publicMetadata(revisions.at(-1)!);
}
