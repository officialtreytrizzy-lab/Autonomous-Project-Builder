import { geminiConfigured } from './gemini.ts';
import { modelFor, type ModelRole } from './model-registry.ts';

export type AiTextPart = { type: 'text'; text: string };
export type AiImagePart = { type: 'image_url'; image_url: { url: string } };
export type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<AiTextPart | AiImagePart>;
};

class OpenRouterRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OpenRouterRequestError';
    this.status = status;
  }
}

export function openRouterConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function requireFreeModel(model: string, lane: string) {
  const normalized = model.trim();
  if (!normalized.endsWith(':free')) {
    throw new Error(`${lane} must use an OpenRouter :free model. Refusing paid model: ${normalized}`);
  }
  return normalized;
}

export function openRouterModelFor(role: ModelRole) {
  const descriptor = modelFor(role);
  if (descriptor.provider !== 'openrouter') throw new Error(`${role} is not an OpenRouter model lane`);
  return requireFreeModel(descriptor.model, role);
}

export function openRouterDesignModel() {
  const descriptor = modelFor('design');
  const configured = descriptor.provider === 'openrouter' ? descriptor.model : process.env.OPENROUTER_DESIGN_MODEL?.trim();
  return requireFreeModel(configured || 'google/gemma-4-26b-a4b-it:free', 'Design model');
}

export function openRouterDesignFallbackModel() {
  const configured = process.env.BUILDER_DESIGN_FALLBACK_MODEL?.trim();
  const descriptor = modelFor('design');
  const registryFallback = descriptor.provider === 'openrouter' ? descriptor.fallbackModels?.[0] : null;
  return requireFreeModel(configured || registryFallback || 'google/gemma-4-31b-it:free', 'Design fallback model');
}

function responseText(payload: unknown) {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : {};
  if (typeof message.content === 'string') return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
        ? String((part as Record<string, unknown>).text)
        : '')
      .join('\n')
      .trim();
  }
  return '';
}

async function requestOpenRouter(input: {
  apiKey: string;
  model: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
}) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
      'x-title': 'Autonomous Project Builder',
      'http-referer': 'http://127.0.0.1',
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      max_tokens: input.maxTokens ?? 3600,
      temperature: input.temperature ?? 0.45,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
    const message = typeof error.message === 'string' ? error.message : `OpenRouter request failed with HTTP ${response.status}`;
    throw new OpenRouterRequestError(response.status, message);
  }
  const text = responseText(payload);
  if (!text) throw new Error(`${input.model} returned an empty response`);
  return text;
}

function shouldUseFreeFallback(error: unknown) {
  if (error instanceof OpenRouterRequestError) {
    return error.status === 429 || error.status === 503 || error.status === 502 || error.status === 504 || error.status === 404;
  }
  if (error instanceof Error) {
    return /rate limit|quota|busy|unavailable|overloaded|timed out|abort/i.test(error.message);
  }
  return false;
}

export async function callOpenRouter(input: {
  messages: AiMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');
  const primaryModel = input.model ? requireFreeModel(input.model, 'Custom model') : openRouterDesignModel();
  const fallbackModel = openRouterDesignFallbackModel();
  try {
    return await requestOpenRouter({
      apiKey,
      model: primaryModel,
      messages: input.messages,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('returned an empty response')) {
      return await requestOpenRouter({
        apiKey,
        model: fallbackModel,
        messages: input.messages,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
    }
    if (fallbackModel !== primaryModel && shouldUseFreeFallback(error)) {
      return await requestOpenRouter({
        apiKey,
        model: fallbackModel,
        messages: input.messages,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
    }
    throw error;
  }
}

export function extractFirstJsonObject(text: string) {
  const trimmed = text.trim();
  const directMatch = trimmed.match(/\{[\s\S]*\}/);
  if (directMatch) {
    try {
      return JSON.parse(directMatch[0]);
    } catch {
      // fall through
    }
  }
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1]);
  }
  return JSON.parse(trimmed);
}
