import { callGeminiImage, geminiConfigured, geminiDesignImageSize, type GeminiGeneratedImage } from './gemini.ts';

export type DesignImageSize = '1K' | '2K' | '4K';
export type DesignImageProvider = 'cloudflare' | 'gemini';

export type DesignGeneratedImage = {
  mimeType: string;
  data: string;
  model: string;
  provider: DesignImageProvider;
};

export class DesignImageRequestError extends Error {
  status: number;
  model: string;

  constructor(status: number, model: string, message: string) {
    super(message);
    this.name = 'DesignImageRequestError';
    this.status = status;
    this.model = model;
  }
}

export function cloudflareAccountId() {
  return process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || '';
}

export function cloudflareApiToken() {
  return process.env.CLOUDFLARE_API_TOKEN?.trim() || '';
}

export function cloudflareImageConfigured() {
  return Boolean(cloudflareAccountId() && cloudflareApiToken());
}

export function designImageProvider(): DesignImageProvider {
  const configured = process.env.BUILDER_DESIGN_IMAGE_PROVIDER?.trim().toLowerCase();
  if (configured === 'gemini') return 'gemini';
  if (configured === 'cloudflare') return 'cloudflare';
  return cloudflareImageConfigured() ? 'cloudflare' : 'gemini';
}

export function designImageModel() {
  return process.env.BUILDER_DESIGN_IMAGE_MODEL?.trim() || '@cf/black-forest-labs/flux-2-klein-4b';
}

export function designImageFallbackModel() {
  return process.env.BUILDER_DESIGN_IMAGE_FALLBACK?.trim() || '@cf/black-forest-labs/flux-1-schnell';
}

export function designImageQualityModel() {
  return process.env.BUILDER_DESIGN_IMAGE_QUALITY_MODEL?.trim() || '@cf/leonardo/phoenix-1.0';
}

export function designImageSize(): DesignImageSize {
  return geminiDesignImageSize();
}

export function designImageConfigured() {
  const provider = designImageProvider();
  return provider === 'cloudflare' ? cloudflareImageConfigured() || geminiConfigured() : geminiConfigured() || cloudflareImageConfigured();
}

export function designImageStatus() {
  return {
    configured: designImageConfigured(),
    provider: designImageProvider(),
    model: designImageModel(),
    fallbackModel: designImageFallbackModel(),
    qualityModel: designImageQualityModel(),
    size: designImageSize(),
  };
}

function dimensions(aspectRatio = '16:9', imageSize: DesignImageSize = designImageSize()) {
  const large = imageSize === '2K' || imageSize === '4K';
  if (aspectRatio === '9:16') return large ? { width: 1080, height: 1920 } : { width: 576, height: 1024 };
  if (aspectRatio === '1:1') return large ? { width: 1920, height: 1920 } : { width: 1024, height: 1024 };
  if (aspectRatio === '4:3') return large ? { width: 1920, height: 1440 } : { width: 1024, height: 768 };
  if (aspectRatio === '3:4') return large ? { width: 1440, height: 1920 } : { width: 768, height: 1024 };
  return large ? { width: 1920, height: 1080 } : { width: 1024, height: 576 };
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

function cloudflareError(payload: unknown, status: number, model: string) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.errors) && record.errors.length) {
      const first = record.errors[0];
      if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).message === 'string') {
        return new DesignImageRequestError(status, model, String((first as Record<string, unknown>).message));
      }
    }
    if (record.error && typeof record.error === 'object' && typeof (record.error as Record<string, unknown>).message === 'string') {
      return new DesignImageRequestError(status, model, String((record.error as Record<string, unknown>).message));
    }
  }
  return new DesignImageRequestError(status, model, `Cloudflare image request failed with HTTP ${status}`);
}

async function parseCloudflareImageResponse(response: Response, model: string): Promise<DesignGeneratedImage> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw cloudflareError(payload, response.status, model);
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const result = record.result && typeof record.result === 'object' ? record.result as Record<string, unknown> : record;
    const image = typeof result.image === 'string' ? result.image : typeof record.image === 'string' ? record.image : '';
    if (!image) throw new Error(`${model} returned no rendered image`);
    const mimeType = typeof result.mimeType === 'string' ? result.mimeType : 'image/jpeg';
    return { mimeType, data: image, model, provider: 'cloudflare' };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new DesignImageRequestError(response.status, model, bytes.toString('utf8').slice(0, 500) || `Cloudflare image request failed with HTTP ${response.status}`);
  if (!bytes.length) throw new Error(`${model} returned an empty image response`);
  return { mimeType: contentType.split(';')[0] || 'image/jpeg', data: bytes.toString('base64'), model, provider: 'cloudflare' };
}

export async function requestCloudflareImage(input: {
  accountId: string;
  apiToken: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: DesignImageSize;
  referenceDataUrls?: string[];
  fetchImpl?: typeof fetch;
}): Promise<DesignGeneratedImage> {
  const fetchImpl = input.fetchImpl || fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/ai/run/${input.model}`;
  const { width, height } = dimensions(input.aspectRatio, input.imageSize);
  const isKlein = input.model.includes('flux-2-klein');
  const isSchnell = input.model.includes('flux-1-schnell');

  let response: Response;
  if (isKlein) {
    const form = new FormData();
    form.append('prompt', input.prompt.slice(0, 8000));
    form.append('width', String(width));
    form.append('height', String(height));
    for (const [index, dataUrl] of (input.referenceDataUrls || []).slice(0, 4).entries()) {
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) continue;
      const bytes = Buffer.from(parsed.data, 'base64');
      form.append(`input_image_${index}`, new Blob([bytes], { type: parsed.mimeType }), `reference-${index}`);
    }
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiToken}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } else {
    const body: Record<string, unknown> = { prompt: input.prompt.slice(0, isSchnell ? 2048 : 8000) };
    if (isSchnell) {
      body.steps = 4;
    } else {
      body.width = Math.min(width, 2048);
      body.height = Math.min(height, 2048);
      body.guidance = 4;
      body.num_steps = 28;
      body.negative_prompt = 'device frame, laptop, monitor, desk, hands, presentation board, illegible text, distorted interface';
    }
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  }

  return parseCloudflareImageResponse(response, input.model);
}

function fromGemini(image: GeminiGeneratedImage): DesignGeneratedImage {
  return { ...image, provider: 'gemini' };
}

export async function callDesignImage(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: DesignImageSize;
  referenceDataUrls?: string[];
  quality?: boolean;
}): Promise<DesignGeneratedImage> {
  const preferredProvider = designImageProvider();
  if (preferredProvider === 'gemini') {
    try {
      return fromGemini(await callGeminiImage(input));
    } catch (geminiError) {
      if (!cloudflareImageConfigured()) throw geminiError;
    }
  }

  if (cloudflareImageConfigured()) {
    const accountId = cloudflareAccountId();
    const apiToken = cloudflareApiToken();
    const candidates = input.quality
      ? [designImageQualityModel(), input.model || designImageModel(), designImageFallbackModel()]
      : [input.model || designImageModel(), designImageFallbackModel()];
    let firstError: unknown = null;
    for (const model of [...new Set(candidates.filter(Boolean))]) {
      try {
        return await requestCloudflareImage({
          accountId,
          apiToken,
          model,
          prompt: input.prompt,
          aspectRatio: input.aspectRatio,
          imageSize: input.imageSize || designImageSize(),
          referenceDataUrls: input.referenceDataUrls,
        });
      } catch (error) {
        if (!firstError) firstError = error;
      }
    }
    if (!geminiConfigured()) throw firstError instanceof Error ? firstError : new Error(String(firstError || 'Cloudflare image rendering failed'));
  }

  if (geminiConfigured()) return fromGemini(await callGeminiImage(input));
  throw new Error('No design image provider is configured. Configure Cloudflare Workers AI or Gemini image generation.');
}
