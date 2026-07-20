import { describe, expect, it } from 'vitest';
import type { AnthropicMessage, DisplayMessage } from './messages';
import {
  MEGABYTE,
  assertScreenshotWithinLimits,
  assertHistoryScreenshotsWithinLimits,
  assertUserInputWithinLimit,
  countTextCharacters,
  inspectPngDataUrl,
  pruneApiHistoryForNewestTurn,
  pruneDisplayHistoryForNewestTurn,
} from './request-limits';
import type { SnapScreenLimits } from './storage';

const LIMITS: SnapScreenLimits = {
  maxInputCharacters: 4_000,
  maxScreenshotBytes: 5 * MEGABYTE,
  maxScreenshotDimension: 2_576,
  maxConversationTurns: 4,
};

function pngDataUrl(width: number, height: number, bytes = 24): string {
  const data = new Uint8Array(Math.max(bytes, 24));
  data.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  data.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  new DataView(data.buffer).setUint32(16, width);
  new DataView(data.buffer).setUint32(20, height);
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

function apiTurn(index: number, image = false): AnthropicMessage[] {
  return [
    image
      ? {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'AA==' },
            },
          ],
        }
      : { role: 'user', content: `question-${index}` },
    { role: 'assistant', content: `answer-${index}` },
  ];
}

describe('user input limits', () => {
  it('counts Unicode code points and accepts the exact boundary', () => {
    expect(countTextCharacters('A🙂B')).toBe(3);
    expect(() => assertUserInputWithinLimit('A🙂B', 3)).not.toThrow();
  });

  it('rejects overflow without truncating the submitted input', () => {
    const input = 'keep all of me';
    expect(() => assertUserInputWithinLimit(input, 5)).toThrowError(
      expect.objectContaining({ code: 'input_too_long' }),
    );
    expect(input).toBe('keep all of me');
  });
});

describe('screenshot limits', () => {
  it('reads PNG payload bytes and dimensions', () => {
    expect(inspectPngDataUrl(pngDataUrl(800, 600, 30))).toEqual({
      bytes: 30,
      width: 800,
      height: 600,
    });
  });

  it('accepts exact byte and dimension boundaries', () => {
    const dataUrl = pngDataUrl(2_576, 2_576, 30);
    expect(() => assertScreenshotWithinLimits(dataUrl, {
      ...LIMITS,
      maxScreenshotBytes: 30,
    })).not.toThrow();
  });

  it('reports payload and dimension overflow separately', () => {
    expect(() => assertScreenshotWithinLimits(pngDataUrl(100, 100, 31), {
      ...LIMITS,
      maxScreenshotBytes: 30,
    })).toThrowError(expect.objectContaining({
      code: 'screenshot_too_large',
    }));

    expect(() => assertScreenshotWithinLimits(pngDataUrl(2_577, 100), LIMITS))
      .toThrowError(expect.objectContaining({
        code: 'screenshot_dimensions_too_large',
      }));
  });

  it('rejects malformed or non-PNG data URLs predictably', () => {
    expect(() => inspectPngDataUrl('data:image/png;base64,QUJD'))
      .toThrowError(expect.objectContaining({
        code: 'screenshot_invalid',
      }));
  });

  it('applies screenshot limits to image blocks retained in follow-up history', () => {
    const data = pngDataUrl(2_577, 100).split(',')[1];
    expect(() => assertHistoryScreenshotsWithinLimits([
      {
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data },
        }],
      },
      { role: 'assistant', content: 'Stopped.' },
    ], LIMITS)).toThrowError(expect.objectContaining({
      code: 'screenshot_dimensions_too_large',
    }));
  });
});

describe('conversation pruning', () => {
  it('preserves the pinned image pair and newest complete pairs', () => {
    const history = [
      ...apiTurn(0, true),
      ...apiTurn(1),
      ...apiTurn(2),
      ...apiTurn(3),
      ...apiTurn(4),
    ];

    const result = pruneApiHistoryForNewestTurn(history, 4);

    expect(result.removedTurns).toBe(2);
    expect(result.messages).toEqual([
      ...apiTurn(0, true),
      ...apiTurn(3),
      ...apiTurn(4),
    ]);
  });

  it('keeps the newest request budget even at the minimum two-turn limit', () => {
    const history = [...apiTurn(0, true), ...apiTurn(1), ...apiTurn(2)];
    expect(pruneApiHistoryForNewestTurn(history, 2).messages).toEqual(apiTurn(0, true));
  });

  it('uses the same complete-pair policy for visible history', () => {
    const display: DisplayMessage[] = [
      { role: 'assistant', content: 'initial' },
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'new' },
      { role: 'assistant', content: 'new answer' },
    ];
    expect(pruneDisplayHistoryForNewestTurn(display, 2)).toEqual({
      messages: display.slice(0, 1),
      removedTurns: 2,
    });
  });

  it('rejects incomplete or split turns instead of silently dropping them', () => {
    expect(() => pruneDisplayHistoryForNewestTurn([
      { role: 'assistant', content: 'initial' },
      { role: 'user', content: 'unfinished' },
    ], 4)).toThrowError(expect.objectContaining({
      code: 'conversation_incomplete',
    }));
  });
});
