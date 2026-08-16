import { readFileSync } from 'node:fs';

import { geminiApiKey, geminiConfigured } from '../ai/gemini.ts';
import type { BuildBriefContent, BuildInputKind, BuildInputRequirement, EvidenceKind, EvidenceRecord, EvidenceRegion, RequirementField } from './types.ts';

export type PageVisualResult = {
  pageSummary: string;
  meaningfulVisuals: Array<{
    kind: Exclude<EvidenceKind, 'user-text' | 'native-text' | 'ocr-text' | 'page-overview' | 'embedded-visual'>;
    description: string;
    relationships: string[];
    region?: EvidenceRegion;
    confidence: number;
  }>;
  ocrText?: string;
  uncertainties: string[];
};

export type VisionClient = {
  inspect(input: { imagePath: string; page: number; nativeText: string; requestOcr: boolean }): Promise<PageVisualResult>;
  synthesize?(evidence: EvidenceRecord[]): Promise<{
    brief: BuildBriefContent;
    contradictions: string[];
    uncertainties: string[];
    requiredInputs: BuildInputRequirement[];
  }>;
};

const pageSchema = {
  type: 'object',
  required: ['pageSummary', 'meaningfulVisuals', 'uncertainties'],
  properties: {
    pageSummary: { type: 'string' },
    meaningfulVisuals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'description', 'relationships', 'confidence'],
        properties: {
          kind: { enum: ['ui', 'diagram', 'table', 'chart', 'drawing', 'annotation', 'layout', 'other'] },
          description: { type: 'string' },
          relationships: { type: 'array', items: { type: 'string' } },
          region: {
            type: 'object',
            required: ['x', 'y', 'width', 'height'],
            properties: {
              x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
            },
          },
          confidence: { type: 'number' },
        },
      },
    },
    ocrText: { type: 'string' },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
} as const;

const briefFields = [
  'users', 'flows', 'requirements', 'designDirection', 'dataAndIntegrations',
  'exclusions', 'acceptanceTests', 'assumptions',
] as const;

const briefSchema = {
  type: 'object',
  required: ['brief', 'contradictions', 'uncertainties', 'requiredInputs'],
  properties: {
    brief: {
      type: 'object',
      required: ['outcome', ...briefFields],
      properties: {
        outcome: { type: 'string' },
        ...Object.fromEntries(briefFields.map((field) => [field, { type: 'array', items: { type: 'string' } }])),
      },
    },
    contradictions: { type: 'array', items: { type: 'string' } },
    uncertainties: { type: 'array', items: { type: 'string' } },
    requiredInputs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label', 'kind', 'description', 'reason', 'required'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          kind: { enum: ['folder', 'files', 'credential', 'text', 'url', 'device', 'manual'] },
          description: { type: 'string' },
          reason: { type: 'string' },
          required: { type: 'boolean' },
          minCount: { type: 'number' },
          acceptedExtensions: { type: 'array', items: { type: 'string' } },
          provider: { type: 'string' },
          reusable: { type: 'boolean' },
          examples: { type: 'array', items: { type: 'string' } },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'label', 'type'],
              properties: {
                id: { type: 'string' }, label: { type: 'string' }, type: { enum: ['secret', 'text'] },
                required: { type: 'boolean' }, envVar: { type: 'string' }, placeholder: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;

function parseJson<T>(content: string): T {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(normalized) as T;
}

function normalizeVisualResult(value: PageVisualResult): PageVisualResult {
  return {
    pageSummary: String(value.pageSummary || ''),
    meaningfulVisuals: Array.isArray(value.meaningfulVisuals)
      ? value.meaningfulVisuals.map((visual) => ({
          kind: visual.kind || 'other',
          description: String(visual.description || ''),
          relationships: Array.isArray(visual.relationships) ? visual.relationships.map(String) : [],
          ...(visual.region ? { region: visual.region } : {}),
          confidence: Math.max(0, Math.min(1, Number(visual.confidence) || 0)),
        }))
      : [],
    ...(value.ocrText ? { ocrText: String(value.ocrText) } : {}),
    uncertainties: Array.isArray(value.uncertainties) ? value.uncertainties.map(String) : [],
  };
}

function compactEvidence(evidence: EvidenceRecord[]) {
  return evidence.map((item) => ({
    evidenceId: item.evidenceId,
    sourceId: item.sourceId,
    revisionId: item.revisionId,
    ...(typeof item.page === 'number' ? { page: item.page } : {}),
    ...(item.region ? { region: item.region } : {}),
    kind: item.kind,
    content: item.content,
    relationships: item.relationships,
    confidence: item.confidence,
    processingMethod: item.processingMethod,
  }));
}

const buildInputKinds = new Set<BuildInputKind>(['folder', 'files', 'credential', 'text', 'url', 'device', 'manual']);

function safeId(value: unknown, fallback: string) {
  return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function normalizeRequirementField(value: unknown, index: number): RequirementField | null {
  if (!value || typeof value !== 'object') return null;
  const field = value as Partial<RequirementField>;
  return {
    id: safeId(field.id, `field-${index + 1}`),
    label: String(field.label || `Field ${index + 1}`),
    type: field.type === 'text' ? 'text' : 'secret',
    required: field.required !== false,
    ...(field.envVar ? { envVar: String(field.envVar) } : {}),
    ...(field.placeholder ? { placeholder: String(field.placeholder) } : {}),
  };
}

function normalizeRequiredInput(value: unknown, index: number): BuildInputRequirement | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<BuildInputRequirement>;
  const kind = buildInputKinds.has(item.kind as BuildInputKind) ? item.kind as BuildInputKind : 'manual';
  return {
    id: safeId(item.id, `required-input-${index + 1}`),
    label: String(item.label || `Required input ${index + 1}`),
    kind,
    description: String(item.description || ''),
    reason: String(item.reason || ''),
    required: item.required !== false,
    ...(Number(item.minCount) > 0 ? { minCount: Math.max(1, Math.floor(Number(item.minCount))) } : {}),
    ...(Array.isArray(item.acceptedExtensions) ? { acceptedExtensions: item.acceptedExtensions.map(String).filter(Boolean) } : {}),
    ...(item.provider ? { provider: String(item.provider) } : {}),
    ...(typeof item.reusable === 'boolean' ? { reusable: item.reusable } : {}),
    ...(Array.isArray(item.examples) ? { examples: item.examples.map(String).filter(Boolean) } : {}),
    ...(Array.isArray(item.fields) ? { fields: item.fields.map(normalizeRequirementField).filter((field): field is RequirementField => Boolean(field)) } : {}),
  };
}

function normalizeSynthesis(value: {
  brief?: Partial<BuildBriefContent>;
  contradictions?: unknown[];
  uncertainties?: unknown[];
  requiredInputs?: unknown[];
}) {
  const rawBrief = value.brief || {};
  const brief = {
    outcome: String(rawBrief.outcome || ''),
    ...Object.fromEntries(briefFields.map((field) => [
      field,
      Array.isArray(rawBrief[field]) ? rawBrief[field].map(String).filter(Boolean) : [],
    ])),
  } as BuildBriefContent;
  return {
    brief,
    contradictions: Array.isArray(value.contradictions) ? value.contradictions.map(String).filter(Boolean) : [],
    uncertainties: Array.isArray(value.uncertainties) ? value.uncertainties.map(String).filter(Boolean) : [],
    requiredInputs: Array.isArray(value.requiredInputs)
      ? value.requiredInputs.map(normalizeRequiredInput).filter((item): item is BuildInputRequirement => Boolean(item))
      : [],
  };
}

export function createGeminiVisionClient(options: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
} = {}): VisionClient {
  const apiKey = options.apiKey || geminiApiKey();
  const model = options.model || process.env.BUILDER_VISION_MODEL?.trim() || 'gemini-3.7-flash';
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;

  return {
    async inspect(input) {
      const base64 = readFileSync(input.imagePath).toString('base64');
      const ext = input.imagePath.toLowerCase().endsWith('.jpg') || input.imagePath.toLowerCase().endsWith('.jpeg')
        ? 'image/jpeg'
        : 'image/png';
      const prompt = [
        `Inspect page ${input.page} completely as first-class project evidence.`,
        'Understand screenshots, UI mockups, scans, forms, drawings, diagrams, floor plans, flowcharts, tables, charts, annotations, layout, and relationships.',
        'Do not infer invisible details. Record uncertainty explicitly.',
        `Native extracted text for cross-checking: ${input.nativeText || '(none)'}`,
        input.requestOcr ? 'The page lacks useful machine-readable text. Include an accurate OCR transcription in ocrText.' : 'Do not perform OCR unless a visually meaningful label is needed to understand the page.',
        'Coordinates, when supplied, must be normalized from 0 to 1.',
        'Return JSON matching this shape: {"pageSummary":"...","meaningfulVisuals":[{"kind":"ui|diagram|table|chart|drawing|annotation|layout|other","description":"...","relationships":["..."],"confidence":1.0}],"ocrText":"...","uncertainties":["..."]}',
      ].join('\n');

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: ext, data: base64 } },
            ],
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini document vision request failed with HTTP ${response.status}`);
      }

      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim() || '';
      if (!text) throw new Error('Gemini vision returned no structured content');
      return normalizeVisualResult(parseJson<PageVisualResult>(text));
    },
    async synthesize(evidence) {
      const prompt = [
        'Synthesize a complete, production-ready Build Brief from the source evidence below.',
        'Treat textual and visual evidence as equal first-class evidence. Preserve explicit workflows, spatial relationships, UI behavior, data rules, integrations, exclusions, and acceptance conditions.',
        'Evidence whose relationships include source-role:implementation-plan is the authoritative implementation contract. Preserve every explicit requirement, flow, constraint, and acceptance condition from it. Supporting evidence may add context but must never silently override the implementation plan; surface any conflict as a contradiction for the user to resolve.',
        'Ground every conclusion in the supplied evidence. Do not invent features or silently guess.',
        'List direct conflicts between sources in contradictions. List only material unknowns that genuinely require a user decision in uncertainties.',
        'Separately produce requiredInputs: an EXHAUSTIVE machine-readable list of every external or user-controlled thing Builder must receive before the product can be completed in full.',
        'Required inputs include, whenever the evidence requires them: folders, individual files, vocal stems, audio, images, datasets, reference media, model weights, API keys or tokens, service-account access, certificates, signing/provisioning assets, domains/DNS access, physical devices, hardware access, or manual user-only actions.',
        'Do NOT ask the user for software packages, command-line tools, SDKs, ordinary dependencies, generated assets, or accounts/resources that Builder can legitimately provision or discover itself. Only list inputs Builder cannot manufacture, infer, or lawfully obtain on the user\'s behalf.',
        'For folder/files requirements, set minCount to the true minimum and list acceptedExtensions. Example: if an RVC workflow requires 10 clean vocal stems, requiredInputs must contain a required folder/files item with minCount 10 and the relevant audio extensions.',
        'For credentials, set provider, reusable=true when appropriate, and fields with secret/text types. Use standard environment variable names where known, such as HF_TOKEN for Hugging Face. Never invent credential values.',
        'Every required input must explain exactly why it is needed. If no user-supplied input is required, return an empty requiredInputs array.',
        'Phrase each contradiction and uncertainty as a concise question the user can resolve before approval.',
        'The outcome must describe the complete requested product, not the document-processing task.',
        'Return JSON matching: {"brief":{"outcome":"...","users":["..."],"flows":["..."],"requirements":["..."],"designDirection":["..."],"dataAndIntegrations":["..."],"exclusions":["..."],"acceptanceTests":["..."],"assumptions":["..."]},"contradictions":["..."],"uncertainties":["..."],"requiredInputs":[{"id":"...","label":"...","kind":"folder|files|credential|text|url|device|manual","description":"...","reason":"...","required":true}]}',
        `Evidence JSON:\n${JSON.stringify(compactEvidence(evidence))}`,
      ].join('\n');

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: prompt }],
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini brief synthesis failed with HTTP ${response.status}`);
      }

      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim() || '';
      if (!text) throw new Error('Gemini brief synthesis returned no structured content');
      return normalizeSynthesis(parseJson(text));
    },
  };
}

export function createOllamaVisionClient(options: {
  endpoint?: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): VisionClient {
  const endpoint = options.endpoint || process.env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434';
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 300_000;
  return {
    async inspect(input) {
      const base64 = readFileSync(input.imagePath).toString('base64');
      const response = await fetchImpl(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: options.model,
          stream: false,
          think: false,
          format: pageSchema,
          options: { temperature: 0, num_predict: 768 },
          messages: [{
            role: 'user',
            images: [base64],
            content: [
              `Inspect page ${input.page} completely as first-class project evidence.`,
              'Understand screenshots, UI mockups, scans, forms, drawings, diagrams, floor plans, flowcharts, tables, charts, annotations, layout, and relationships.',
              'Do not infer invisible details. Record uncertainty explicitly.',
              `Native extracted text for cross-checking: ${input.nativeText || '(none)'}`,
              input.requestOcr ? 'The page lacks useful machine-readable text. Include an accurate OCR transcription in ocrText.' : 'Do not perform OCR unless a visually meaningful label is needed to understand the page.',
              'Coordinates, when supplied, must be normalized from 0 to 1.',
            ].join('\n'),
          }],
        }),
      });
      if (!response.ok) throw new Error(`Local vision request failed with HTTP ${response.status}`);
      const payload = await response.json() as { message?: { content?: string } };
      if (!payload.message?.content) throw new Error('Local vision returned no structured content');
      return normalizeVisualResult(parseJson<PageVisualResult>(payload.message.content));
    },
    async synthesize(evidence) {
      const response = await fetchImpl(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: options.model,
          stream: false,
          think: false,
          format: briefSchema,
          options: { temperature: 0, num_ctx: 8192, num_predict: 2048 },
          messages: [{
            role: 'user',
            content: [
              'Synthesize a complete, production-ready Build Brief from the source evidence below.',
              'Treat textual and visual evidence as equal first-class evidence. Preserve explicit workflows, spatial relationships, UI behavior, data rules, integrations, exclusions, and acceptance conditions.',
              'Evidence whose relationships include source-role:implementation-plan is the authoritative implementation contract. Preserve every explicit requirement, flow, constraint, and acceptance condition from it. Supporting evidence may add context but must never silently override the implementation plan; surface any conflict as a contradiction for the user to resolve.',
              'Ground every conclusion in the supplied evidence. Do not invent features or silently guess.',
              'List direct conflicts between sources in contradictions. List only material unknowns that genuinely require a user decision in uncertainties.',
              'Separately produce requiredInputs: an EXHAUSTIVE machine-readable list of every external or user-controlled thing Builder must receive before the product can be completed in full.',
              'Required inputs include, whenever the evidence requires them: folders, individual files, vocal stems, audio, images, datasets, reference media, model weights, API keys or tokens, service-account access, certificates, signing/provisioning assets, domains/DNS access, physical devices, hardware access, or manual user-only actions.',
              'Do NOT ask the user for software packages, command-line tools, SDKs, ordinary dependencies, generated assets, or accounts/resources that Builder can legitimately provision or discover itself. Only list inputs Builder cannot manufacture, infer, or lawfully obtain on the user\'s behalf.',
              'For folder/files requirements, set minCount to the true minimum and list acceptedExtensions. Example: if an RVC workflow requires 10 clean vocal stems, requiredInputs must contain a required folder/files item with minCount 10 and the relevant audio extensions.',
              'For credentials, set provider, reusable=true when appropriate, and fields with secret/text types. Use standard environment variable names where known, such as HF_TOKEN for Hugging Face. Never invent credential values.',
              'Every required input must explain exactly why it is needed. If no user-supplied input is required, return an empty requiredInputs array.',
              'Phrase each contradiction and uncertainty as a concise question the user can resolve before approval.',
              'The outcome must describe the complete requested product, not the document-processing task.',
              `Evidence JSON:\n${JSON.stringify(compactEvidence(evidence))}`,
            ].join('\n'),
          }],
        }),
      });
      if (!response.ok) throw new Error(`Local brief synthesis failed with HTTP ${response.status}`);
      const payload = await response.json() as { message?: { content?: string } };
      if (!payload.message?.content) throw new Error('Local brief synthesis returned no structured content');
      return normalizeSynthesis(parseJson(payload.message.content));
    },
  };
}

export function createDocumentVisionClient(): VisionClient {
  if (!geminiConfigured()) throw new Error('Gemini API document vision requires GEMINI_API_KEY.');
  return createGeminiVisionClient();
}

export async function inspectPage(
  page: { page: number; imagePath: string; nativeText: string },
  visionClient: VisionClient,
  requestOcr: boolean,
) {
  return visionClient.inspect({ ...page, requestOcr });
}

export async function synthesizeBrief(evidence: EvidenceRecord[], visionClient: VisionClient) {
  if (!visionClient.synthesize) throw new Error('The configured local vision client does not support brief synthesis');
  return visionClient.synthesize(evidence);
}
