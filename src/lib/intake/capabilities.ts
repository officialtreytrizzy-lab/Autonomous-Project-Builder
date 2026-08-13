import { execFile as execFileCallback, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
const DEFAULT_VISION_MODEL = 'gemma3:4b';
const KNOWN_VISION_FAMILIES = ['gemma3', 'llava', 'llama3.2-vision', 'minicpm-v', 'moondream', 'qwen2-vl', 'qwen2.5-vl', 'qwen3-vl'];

export type DocumentCapabilityReport = {
  word: { available: boolean; detail: string };
  pdfRenderer: { available: boolean; path?: string; detail: string };
  ollama: { installed: boolean; running: boolean; endpoint: string; version?: string };
  vision: { available: boolean; installedCandidates: string[]; model: string; detail: string };
};

export type VisionRecoveryDependencies = {
  discover(): Promise<DocumentCapabilityReport>;
  startService(): Promise<void>;
  repairConfiguration(): Promise<void>;
  restartService(): Promise<void>;
  provisionVisionModel(model: string): Promise<void>;
  healthCheck(): Promise<DocumentCapabilityReport>;
};

type DiscoveryDependencies = {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  commandPath?: (command: string) => Promise<string>;
  wordAvailable?: () => Promise<boolean>;
  localModelNames?: () => string[];
};

async function commandPath(command: string) {
  try {
    const result = await execFile('where.exe', [command], { windowsHide: true, timeout: 5000 });
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  } catch {
    return '';
  }
}

async function wordAvailable() {
  try {
    await execFile('reg.exe', ['query', 'HKCR\\Word.Application\\CLSID'], { windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function localModelNames() {
  const root = process.env.USERPROFILE
    ? join(process.env.USERPROFILE, '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library')
    : '';
  if (!root || !existsSync(root)) return [];
  const names: string[] = [];
  for (const family of readdirSync(root, { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    const familyPath = join(root, family.name);
    for (const tag of readdirSync(familyPath, { withFileTypes: true })) {
      if (tag.isFile()) names.push(`${family.name}:${tag.name}`);
    }
  }
  return names;
}

async function fetchJson(fetchImpl: typeof fetch, url: string, init?: RequestInit) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function discoverDocumentCapabilities(deps: DiscoveryDependencies = {}): Promise<DocumentCapabilityReport> {
  const endpoint = deps.endpoint || process.env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_ENDPOINT;
  const findCommand = deps.commandPath || commandPath;
  const checkWord = deps.wordAvailable || wordAvailable;
  const readLocalModels = deps.localModelNames || localModelNames;
  const fetchImpl = deps.fetchImpl || fetch;
  const configuredRenderer = process.env.PDF_RENDERER_PATH?.trim() || '';
  const [ollamaPath, rendererPath, hasWord] = await Promise.all([
    findCommand('ollama'),
    configuredRenderer && existsSync(configuredRenderer) ? Promise.resolve(configuredRenderer) : findCommand('pdftoppm'),
    checkWord(),
  ]);

  let running = false;
  let version = '';
  let installedNames = readLocalModels();
  try {
    const [versionPayload, tagsPayload] = await Promise.all([
      fetchJson(fetchImpl, `${endpoint}/api/version`),
      fetchJson(fetchImpl, `${endpoint}/api/tags`),
    ]);
    running = true;
    version = typeof versionPayload.version === 'string' ? versionPayload.version : '';
    const models = Array.isArray(tagsPayload.models) ? tagsPayload.models : [];
    installedNames = [...new Set([...installedNames, ...models.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const model = entry as { name?: unknown; model?: unknown };
      const name = typeof model.name === 'string' ? model.name : typeof model.model === 'string' ? model.model : '';
      return name ? [name] : [];
    })])];
  } catch {
    running = false;
  }

  const knownCandidates = installedNames.filter((name) => KNOWN_VISION_FAMILIES.some((family) => name.toLowerCase().startsWith(family)));
  const compatibleModels: string[] = [];
  if (running) {
    for (const name of installedNames) {
      try {
        const shown = await fetchJson(fetchImpl, `${endpoint}/api/show`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: name }),
        });
        const capabilities = Array.isArray(shown.capabilities) ? shown.capabilities : [];
        if (capabilities.includes('vision')) compatibleModels.push(name);
      } catch {
        // One corrupt or incompatible model must not hide other installed candidates.
      }
    }
  }
  const installedCandidates = [...new Set([...compatibleModels, ...knownCandidates])];
  const model = compatibleModels[0] || '';
  const detail = model
    ? `Local vision ready with ${model}`
    : running
      ? 'Ollama is running, but no installed model advertises the vision capability.'
      : ollamaPath
        ? 'Ollama is installed but its local API is not responding.'
        : 'No approved local vision runtime is available.';

  return {
    word: { available: hasWord, detail: hasWord ? 'Microsoft Word document conversion is available.' : 'Microsoft Word COM is unavailable.' },
    pdfRenderer: {
      available: Boolean(rendererPath),
      ...(rendererPath ? { path: rendererPath } : {}),
      detail: rendererPath ? 'A local PDF page renderer is available.' : 'No local PDF page renderer was found.',
    },
    ollama: { installed: Boolean(ollamaPath), running, endpoint, ...(version ? { version } : {}) },
    vision: { available: Boolean(model), installedCandidates, model, detail },
  };
}

async function startOllama() {
  const child = spawn('ollama', ['serve'], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
}

async function provisionVisionModel(model: string) {
  await execFile('ollama', ['pull', model], { windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024 });
}

function defaultRecoveryDependencies(): VisionRecoveryDependencies {
  return {
    discover: () => discoverDocumentCapabilities(),
    startService: startOllama,
    repairConfiguration: async () => undefined,
    restartService: startOllama,
    provisionVisionModel,
    async healthCheck() {
      let latest = await discoverDocumentCapabilities();
      for (let attempt = 0; attempt < 9 && !latest.ollama.running; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        latest = await discoverDocumentCapabilities();
      }
      return latest;
    },
  };
}

export async function recoverVisionCapability(deps: VisionRecoveryDependencies = defaultRecoveryDependencies()) {
  let report = await deps.discover();
  if (report.vision.available || !report.ollama.installed) return report;

  if (!report.ollama.running) {
    await deps.startService();
    report = await deps.healthCheck();
    if (report.vision.available) return report;
  }

  if (!report.ollama.running) {
    await deps.repairConfiguration();
    await deps.restartService();
    report = await deps.healthCheck();
    if (report.vision.available || !report.ollama.running) return report;
  }

  await deps.provisionVisionModel(DEFAULT_VISION_MODEL);
  return deps.healthCheck();
}
