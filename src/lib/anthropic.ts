import type { AnthropicMessage } from './messages';
import { dataUrlToBase64 } from './crop';
import { stripMarkdown } from './plain-text';
import { FOLLOW_UP_SYSTEM_PROMPT, SCREENSHOT_QA_SYSTEM_PROMPT } from './screenshot-qa-prompt';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
const REQUEST_TIMEOUT_MS = 60_000;

export class AnthropicError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnthropicError';
  }
}

export type DeltaHandler = (textSoFar: string) => void;

export async function analyzeImage(
  apiKey: string,
  dataUrl: string,
  prompt: string,
  signal?: AbortSignal,
  onDelta?: DeltaHandler,
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

  const messages: AnthropicMessage[] = [{ role: 'user', content: userContent }];
  const text = await callApi(apiKey, messages, SCREENSHOT_QA_SYSTEM_PROMPT, signal, onDelta);

  return {
    text,
    history: [...messages, { role: 'assistant', content: text }],
  };
}

export async function followUp(
  apiKey: string,
  text: string,
  history: AnthropicMessage[],
  signal?: AbortSignal,
  onDelta?: DeltaHandler,
): Promise<{ text: string; history: AnthropicMessage[] }> {
  const messages: AnthropicMessage[] = [
    ...history,
    { role: 'user', content: text },
  ];

  const answer = await callApi(apiKey, messages, FOLLOW_UP_SYSTEM_PROMPT, signal, onDelta);

  return {
    text: answer,
    history: [...messages, { role: 'assistant', content: answer }],
  };
}

export async function verifyApiKey(apiKey: string, signal?: AbortSignal): Promise<void> {
  await postToApi(
    apiKey,
    {
      model: MODEL,
      max_tokens: 1,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: 'Hi' }],
    },
    signal,
  );
}

async function callApi(
  apiKey: string,
  messages: AnthropicMessage[],
  system: string,
  signal?: AbortSignal,
  onDelta?: DeltaHandler,
): Promise<string> {
  const response = await postToApi(
    apiKey,
    {
      model: MODEL,
      max_tokens: 1024,
      // Thinking off + low effort: fast answers, and the token budget goes
      // entirely to the visible response.
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      stream: true,
      system,
      messages,
    },
    signal,
  );

  const { text, stopReason } = await readSseStream(response, onDelta);

  if (stopReason === 'refusal') {
    throw new AnthropicError('refusal', 'Claude declined to answer this question.');
  }

  if (!text) {
    throw new AnthropicError('api', 'No response text received from the API.');
  }

  const cleaned = stripMarkdown(text);
  if (stopReason === 'max_tokens') {
    return `${cleaned}\n\n(Answer was cut off — ask a follow-up to continue.)`;
  }
  return cleaned;
}

async function readSseStream(
  response: Response,
  onDelta?: DeltaHandler,
): Promise<{ text: string; stopReason?: string }> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new AnthropicError('api', 'No response stream received from the API.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopReason: string | undefined;

  const handleEvent = (rawEvent: string): void => {
    const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) return;

    let data: {
      type?: string;
      delta?: { type?: string; text?: string; stop_reason?: string };
      error?: { message?: string };
    };
    try {
      data = JSON.parse(dataLine.slice(5).trim());
    } catch {
      return;
    }

    switch (data.type) {
      case 'content_block_delta':
        if (data.delta?.type === 'text_delta' && typeof data.delta.text === 'string') {
          text += data.delta.text;
          onDelta?.(stripMarkdown(text));
        }
        break;
      case 'message_delta':
        if (data.delta?.stop_reason) {
          stopReason = data.delta.stop_reason;
        }
        break;
      case 'error':
        throw new AnthropicError('api', data.error?.message ?? 'The API stream reported an error.');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let separator: number;
    while ((separator = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      handleEvent(rawEvent);
    }
  }

  return { text, stopReason };
}

async function postToApi(
  apiKey: string,
  body: object,
  signal?: AbortSignal,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

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
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new AnthropicError('timeout', 'Request timed out. Please try again.');
    }
    throw new AnthropicError('network', 'Network error. Check your connection and try again.');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AnthropicError('auth', 'Invalid API key. Check your settings.');
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const hint =
        retryAfter && /^\d+$/.test(retryAfter)
          ? `Try again in ~${retryAfter}s.`
          : 'Please try again shortly.';
      throw new AnthropicError('rate_limit', `Rate limit reached. ${hint}`);
    }
    if (response.status >= 500) {
      throw new AnthropicError('server', 'Service unavailable. Please try again.');
    }
    const errorBody = await response.text().catch(() => '');
    throw new AnthropicError(
      'api',
      `API error (${response.status}): ${errorBody || 'Unknown error'}`,
    );
  }

  return response;
}
