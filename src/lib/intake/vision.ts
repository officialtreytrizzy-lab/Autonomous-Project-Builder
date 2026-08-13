import { readFileSync } from 'node:fs';

import type { BuildBriefContent, EvidenceKind, EvidenceRecord, EvidenceRegion } from './types.ts';

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

export function createOllamaVisionClient(options: {
  endpoint?: string;
  model: string;
  fetchImpl?: typeof fetch;
}): VisionClient {
  const endpoint = options.endpoint || process.env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434';
  const fetchImpl = options.fetchImpl || fetch;
  return {
    async inspect(input) {
      const base64 = readFileSync(input.imagePath).toString('base64');
      const response = await fetchImpl(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: options.model,
          stream: false,
          format: pageSchema,
          options: { temperature: 0 },
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
  };
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
