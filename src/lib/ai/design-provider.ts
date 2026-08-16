import { callGemini, geminiConfigured, geminiDesignFallbackModel, geminiDesignModel } from './gemini.ts';
import { designImageStatus } from './design-image.ts';
import { callGroqVision, groqConfigured, groqVisionModel } from './groq.ts';
import { callOpenRouter, openRouterConfigured, openRouterDesignFallbackModel, openRouterDesignModel, type AiMessage } from './openrouter.ts';

export function designProviderConfigured() {
  return geminiConfigured() || openRouterConfigured() || groqConfigured();
}

export function designProviderStatus() {
  const isGemini = geminiConfigured();
  const image = designImageStatus();
  return {
    configured: designProviderConfigured(),
    model: isGemini ? geminiDesignModel() : openRouterDesignModel(),
    fallbackModel: isGemini ? geminiDesignFallbackModel() : openRouterDesignFallbackModel(),
    imageConfigured: image.configured,
    imageProvider: image.provider,
    imageModel: image.model,
    imageFallbackModel: image.fallbackModel,
    imageQualityModel: image.qualityModel,
    imageSize: image.size,
    providerFallback: isGemini
      ? (openRouterConfigured() ? `OpenRouter ${openRouterDesignModel()}` : (groqConfigured() ? `Groq ${groqVisionModel()}` : null))
      : (groqConfigured() ? `Groq ${groqVisionModel()}` : null),
  };
}

function isPaidRouteGuard(error: unknown) {
  return error instanceof Error && /Refusing paid model|must use an OpenRouter :free model/i.test(error.message);
}

export async function callDesignDirector(input: {
  messages: AiMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}) {
  let geminiError: unknown = null;
  if (geminiConfigured()) {
    try {
      return await callGemini(input);
    } catch (error) {
      geminiError = error;
    }
  }

  let openRouterError: unknown = null;
  if (openRouterConfigured()) {
    try {
      return await callOpenRouter(input);
    } catch (error) {
      if (isPaidRouteGuard(error)) throw error;
      openRouterError = error;
    }
  }

  if (groqConfigured()) {
    try {
      return await callGroqVision({
        messages: input.messages,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
    } catch (groqError) {
      const geminiMessage = geminiError instanceof Error ? geminiError.message : geminiError ? String(geminiError) : 'not configured';
      const openRouterMessage = openRouterError instanceof Error ? openRouterError.message : openRouterError ? String(openRouterError) : 'not configured';
      const groqMessage = groqError instanceof Error ? groqError.message : String(groqError);
      throw new Error(`Design providers are temporarily unavailable. Gemini: ${geminiMessage}. OpenRouter: ${openRouterMessage}. Groq: ${groqMessage}. Your design conversation is saved; retry when a provider is available.`);
    }
  }

  if (geminiError && !openRouterConfigured() && !groqConfigured()) {
    const message = geminiError instanceof Error ? geminiError.message : String(geminiError);
    throw new Error(`Gemini design provider unavailable: ${message}. Your design conversation is saved; retry when the provider is available.`);
  }

  if (openRouterError) {
    const message = openRouterError instanceof Error ? openRouterError.message : String(openRouterError);
    throw new Error(`Design provider unavailable: ${message}. Your design conversation is saved; retry when the provider is available.`);
  }

  throw new Error('No design provider is configured. Add Gemini, OpenRouter, or Groq access to continue.');
}
