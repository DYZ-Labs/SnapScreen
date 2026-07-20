import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeHostOptions {
  onMessage: (message: {
    type: string;
    sessionId: string;
    rect?: { x: number; y: number; width: number; height: number };
  }) => void;
  onUnexpectedDispose?: () => void;
  onUnavailable?: () => void;
}

const mockState = vi.hoisted(() => ({
  ...(() => {
    const instances: FakeFrameHost[] = [];
    class FakeFrameHost {
      isDisposed = false;
      readonly options: FakeHostOptions;
      readonly send = vi.fn(() => true);
      readonly setInteractive = vi.fn();

      constructor(options: FakeHostOptions) {
        this.options = options;
        instances.push(this);
      }

      dispose(): void {
        this.isDisposed = true;
      }

      emit(message: Parameters<FakeHostOptions['onMessage']>[0]): void {
        this.options.onMessage(message);
      }

      failUnexpectedly(): void {
        this.isDisposed = true;
        this.options.onUnexpectedDispose?.();
      }

      failUnavailable(): void {
        this.isDisposed = true;
        this.options.onUnavailable?.();
      }
    }
    return { FakeFrameHost, instances };
  })(),
}));

vi.mock('./result-frame-host', () => ({
  ResultFrameHost: mockState.FakeFrameHost,
}));

import {
  disposeResultPanel,
  startSnipOverlay,
} from './ui-proxy';

beforeEach(() => {
  mockState.instances.length = 0;
  vi.stubGlobal('chrome', {
    runtime: {
      openOptionsPage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
  });
});

afterEach(() => {
  disposeResultPanel();
  mockState.instances.length = 0;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('isolated UI proxy lifecycle', () => {
  it('starts snipping without a mutable hint payload', () => {
    startSnipOverlay({ onRegionSelected: vi.fn(), onCancelled: vi.fn() });

    expect(mockState.instances[0].send).toHaveBeenCalledWith({
      type: 'SNAPSCREEN_UI_START_SNIP',
    });
  });

  it('cancels the capture if the frame disappears after selection but before delivery', () => {
    const onRegionSelected = vi.fn();
    const onCancelled = vi.fn();
    startSnipOverlay({ onRegionSelected, onCancelled });
    const host = mockState.instances[0];

    host.emit({
      type: 'SNAPSCREEN_UI_REGION_SELECTED',
      sessionId: 'session',
      rect: { x: 10, y: 20, width: 100, height: 80 },
    });
    expect(onRegionSelected).toHaveBeenCalledTimes(1);

    host.failUnexpectedly();

    expect(onCancelled).toHaveBeenCalledTimes(1);
  });

  it('cancels active work and requests browser-chrome feedback when the frame is unavailable', async () => {
    const onCancelled = vi.fn();
    startSnipOverlay({ onRegionSelected: vi.fn(), onCancelled });
    const host = mockState.instances[0];

    host.failUnavailable();
    await Promise.resolve();

    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'UI_UNAVAILABLE',
    });
  });
});
