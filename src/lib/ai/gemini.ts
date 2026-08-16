import type { AiMessage } from './openrouter.ts';

export class GeminiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GeminiRequestError';
    this.status = status;
  }
}

export function geminiApiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || '';
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim());
}

export function geminiDesignModel(): string {
  return process.env.BUILDER_DESIGN_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-3.7-flash';
}

export function geminiDesignFallbackModel(): string {
  return process.env.BUILDER_DESIGN_FALLBACK_MODEL?.trim() || 'gemini-flash-latest';
}

export function geminiDesignImageModel(): string {
  return process.env.BUILDER_DESIGN_IMAGE_MODEL?.trim() || 'gemini-3.1-flash-image';
}

export function geminiDesignImageSize(): '1K' | '2K' | '4K' {
  const configured = process.env.BUILDER_DESIGN_IMAGE_SIZE?.trim().toUpperCase();
  return configured === '1K' || configured === '4K' ? configured : '2K';
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiPart[];
};

export async function requestGemini(input: {
  apiKey: string;
  model: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`;
  const contents: GeminiContent[] = [];
  let systemInstructionText = '';

  for (const msg of input.messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.map((p) => p.type === 'text' ? p.text : '').join('\n');
      systemInstructionText = systemInstructionText ? `${systemInstructionText}\n\n${text}` : text;
      continue;
    }

    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [];

    if (typeof msg.content === 'string') {
      if (msg.content.trim()) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          if (part.text.trim()) {
            parts.push({ text: part.text });
          }
        } else if (part.type === 'image_url') {
          const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: input.temperature ?? 0.45,
      maxOutputTokens: input.maxTokens ?? 4096,
    },
  };

  if (systemInstructionText) {
    body.systemInstruction = {
      parts: [{ text: systemInstructionText }],
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': input.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
    const errorMsg = typeof error.message === 'string' ? error.message : `Gemini request failed with HTTP ${response.status}`;
    throw new GeminiRequestError(response.status, errorMsg);
  }

  const candidate = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates?.[0];
  if (!candidate || !candidate.content?.parts) {
    throw new Error(`${input.model} returned an empty response`);
  }

  const text = candidate.content.parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();

  if (!text) {
    throw new Error(`${input.model} returned an empty text response`);
  }

  return text;
}

export type GeminiGeneratedImage = {
  mimeType: string;
  data: string;
  model: string;
};

function dataUrlToInlinePart(dataUrl: string): GeminiPart | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  return match ? { inlineData: { mimeType: match[1], data: match[2] } } : null;
}

export async function requestGeminiImage(input: {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: '1K' | '2K' | '4K';
  referenceDataUrls?: string[];
}): Promise<GeminiGeneratedImage> {
  const url = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  const interactionInput: Array<Record<string, string>> = [
    { type: 'text', text: input.prompt },
  ];
  for (const dataUrl of input.referenceDataUrls || []) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) interactionInput.push({ type: 'image', mime_type: match[1], data: match[2] });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': input.apiKey,
    },
    body: JSON.stringify({
      model: input.model,
      input: interactionInput,
      response_format: {
        type: 'image',
        mime_type: 'image/jpeg',
        aspect_ratio: input.aspectRatio || '16:9',
        image_size: input.imageSize || geminiDesignImageSize(),
      },
      store: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
    const errorMsg = typeof error.message === 'string' ? error.message : `Gemini image request failed with HTTP ${response.status}`;
    throw new GeminiRequestError(response.status, errorMsg);
  }

  const steps = (payload as {
    steps?: Array<{
      type?: string;
      content?: Array<{ type?: string; mime_type?: string; data?: string; uri?: string }>;
    }>;
  }).steps || [];
  for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = steps[stepIndex];
    if (step.type !== 'model_output') continue;
    for (const content of step.content || []) {
      if (content.type === 'image' && content.data) {
        return {
          mimeType: content.mime_type || 'image/jpeg',
          data: content.data,
          model: input.model,
        };
      }
    }
  }
  throw new Error(`${input.model} returned no rendered image`);
}
export async function callGeminiImage(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: '1K' | '2K' | '4K';
  referenceDataUrls?: string[];
}): Promise<GeminiGeneratedImage> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  return requestGeminiImage({
    apiKey,
    model: input.model || geminiDesignImageModel(),
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize || geminiDesignImageSize(),
    referenceDataUrls: input.referenceDataUrls,
  });
}

export async function callGemini(input: {
  messages: AiMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const primaryModel = input.model || geminiDesignModel();
  const fallbackModel = geminiDesignFallbackModel();

  try {
    return await requestGemini({
      apiKey,
      model: primaryModel,
      messages: input.messages,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
    });
  } catch (primaryError) {
    if (fallbackModel && fallbackModel !== primaryModel) {
      try {
        return await requestGemini({
          apiKey,
          model: fallbackModel,
          messages: input.messages,
          maxTokens: input.maxTokens,
          temperature: input.temperature,
        });
      } catch {
        throw primaryError;
      }
    }
    throw primaryError;
  }
}
