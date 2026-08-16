import type { AiMessage } from './openrouter.ts';

export function groqConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function groqVisionModel() {
  return process.env.GROQ_VISION_MODEL?.trim() || 'qwen/qwen3.6-27b';
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

export async function callGroqVision(input: {
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
}) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error('Groq API key is not configured');
  const model = groqVisionModel();
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      max_completion_tokens: input.maxTokens ?? 3600,
      temperature: input.temperature ?? 0.45,
      reasoning_format: 'hidden',
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
    const message = typeof error.message === 'string' ? error.message : `Groq request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  const text = responseText(payload);
  if (!text) throw new Error(`${model} returned an empty response`);
  return text;
}
