import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeImage, followUp, verifyApiKey, AnthropicError } from './anthropic';
import type { AnthropicContentBlock, AnthropicMessage } from './messages';

function stubFetch(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: init?.headers,
      }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

function lastRequestBody(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, requestInit] = mock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(requestInit.body as string) as Record<string, unknown>;
}

const okBody = { content: [{ type: 'text', text: 'Answer' }], stop_reason: 'end_turn' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analyzeImage', () => {
  it('builds a single user message with image and prompt, and returns history', async () => {
    const mock = stubFetch(okBody);
    const result = await analyzeImage('key', 'data:image/png;base64,QUJD', 'What is this?');

    expect(result.text).toBe('Answer');
    expect(result.history).toHaveLength(2);

    const content = result.history[0].content as AnthropicContentBlock[];
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
    });
    expect(content[1]).toEqual({ type: 'text', text: 'What is this?' });
    expect(result.history[1]).toEqual({ role: 'assistant', content: 'Answer' });

    const body = lastRequestBody(mock);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.output_config).toEqual({ effort: 'low' });
  });

  it('strips markdown from the answer', async () => {
    stubFetch({ content: [{ type: 'text', text: '**Bold** answer' }], stop_reason: 'end_turn' });
    const result = await analyzeImage('key', 'data:image/png;base64,QUJD', 'Q?');
    expect(result.text).toBe('Bold answer');
  });

  it('appends a cut-off notice when stop_reason is max_tokens', async () => {
    stubFetch({ content: [{ type: 'text', text: 'Partial' }], stop_reason: 'max_tokens' });
    const result = await analyzeImage('key', 'data:image/png;base64,QUJD', 'Q?');
    expect(result.text).toContain('Partial');
    expect(result.text).toContain('cut off');
  });

  it('throws a refusal error when stop_reason is refusal', async () => {
    stubFetch({ content: [], stop_reason: 'refusal' });
    await expect(analyzeImage('key', 'data:image/png;base64,QUJD', 'Q?')).rejects.toMatchObject({
      code: 'refusal',
    });
  });

  it('maps 401 to an auth error', async () => {
    stubFetch({}, { status: 401 });
    const promise = analyzeImage('key', 'data:image/png;base64,QUJD', 'Q?');
    await expect(promise).rejects.toBeInstanceOf(AnthropicError);
    await expect(promise).rejects.toMatchObject({ code: 'auth' });
  });

  it('includes retry-after timing in 429 errors', async () => {
    stubFetch({}, { status: 429, headers: { 'retry-after': '30' } });
    await expect(analyzeImage('key', 'data:image/png;base64,QUJD', 'Q?')).rejects.toMatchObject({
      code: 'rate_limit',
      message: expect.stringContaining('~30s'),
    });
  });

  it('maps 500 to a server error', async () => {
    stubFetch({}, { status: 500 });
    await expect(analyzeImage('key', 'data:image/png;base64,QUJD', 'Q?')).rejects.toMatchObject({
      code: 'server',
    });
  });
});

describe('followUp', () => {
  it('appends the question and answer to the existing history', async () => {
    stubFetch(okBody);
    const history: AnthropicMessage[] = [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ];

    const result = await followUp('key', 'And this?', history);

    expect(result.history).toHaveLength(4);
    expect(result.history[2]).toEqual({ role: 'user', content: 'And this?' });
    expect(result.history[3]).toEqual({ role: 'assistant', content: 'Answer' });
    expect(history).toHaveLength(2); // input history is not mutated
  });
});

describe('verifyApiKey', () => {
  it('resolves for a working key', async () => {
    const mock = stubFetch(okBody);
    await expect(verifyApiKey('key')).resolves.toBeUndefined();
    expect(lastRequestBody(mock).max_tokens).toBe(1);
  });

  it('rejects with an auth error for a bad key', async () => {
    stubFetch({}, { status: 403 });
    await expect(verifyApiKey('bad')).rejects.toMatchObject({ code: 'auth' });
  });
});
