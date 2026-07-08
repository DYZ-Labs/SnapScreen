import type { AnthropicMessage } from './messages';
import { dataUrlToBase64 } from './crop';
import { stripMarkdown } from './plain-text';
import { FOLLOW_UP_SYSTEM_PROMPT, SCREENSHOT_QA_SYSTEM_PROMPT } from './screenshot-qa-prompt';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

export class AnthropicError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnthropicError';
  }
}

export async function analyzeImage(
  apiKey: string,
  dataUrl: string,
  prompt: string,
  history?: AnthropicMessage[],
  signal?: AbortSignal,
): Promise<{ text: string; history: AnthropicMessage[] }> {
  const base64 = dataUrlToBase64(dataUrl);

  const userContent = [
    {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: base64,
      },
    },
    { type: 'text' as const, text: prompt },
  ];

  const messages: AnthropicMessage[] = history?.length
    ? [...history]
    : [{ role: 'user', content: userContent }];

  if (history?.length) {
    messages.push({ role: 'user', content: prompt });
  }

  const text = await callApi(apiKey, messages, SCREENSHOT_QA_SYSTEM_PROMPT, signal);

  const updatedHistory: AnthropicMessage[] = history?.length
    ? [...history, { role: 'user', content: prompt }, { role: 'assistant', content: text }]
    : [
        { role: 'user', content: userContent },
        { role: 'assistant', content: text },
      ];

  return { text, history: updatedHistory };
}

export async function followUp(
  apiKey: string,
  text: string,
  history: AnthropicMessage[],
  signal?: AbortSignal,
): Promise<{ text: string; history: AnthropicMessage[] }> {
  const messages: AnthropicMessage[] = [
    ...history,
    { role: 'user', content: text },
  ];

  const answer = await callApi(apiKey, messages, FOLLOW_UP_SYSTEM_PROMPT, signal);

  return {
    text: answer,
    history: [...messages, { role: 'assistant', content: answer }],
  };
}

async function callApi(
  apiKey: string,
  messages: AnthropicMessage[],
  system: string,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        messages,
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new AnthropicError('network', 'Network error. Check your connection and try again.');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AnthropicError('auth', 'Invalid API key. Check your settings.');
    }
    if (response.status === 429) {
      throw new AnthropicError('rate_limit', 'Rate limit reached. Please try again shortly.');
    }
    if (response.status >= 500) {
      throw new AnthropicError('server', 'Service unavailable. Please try again.');
    }
    const body = await response.text().catch(() => '');
    throw new AnthropicError('api', `API error (${response.status}): ${body || 'Unknown error'}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = data.content?.find((b) => b.type === 'text')?.text;
  if (!text) {
    throw new AnthropicError('api', 'No response text received from the API.');
  }

  return stripMarkdown(text);
}
