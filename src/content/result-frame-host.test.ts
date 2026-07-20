/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultFrameHost } from './result-frame-host';

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
  });
});

afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('extension-frame host lifecycle', () => {
  it('mounts behind a closed shadow boundary and disposes idempotently', () => {
    const previousFocus = document.createElement('button');
    document.body.append(previousFocus);
    previousFocus.focus();
    const onUnexpectedDispose = vi.fn();
    const host = new ResultFrameHost({
      onMessage: vi.fn(),
      onUnexpectedDispose,
      skipFrameNavigationForTesting: true,
    });

    const outerHost = document.querySelector<HTMLElement>('#snapscreen-ui-host');
    expect(outerHost?.shadowRoot).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();

    host.dispose();
    host.dispose();

    expect(document.querySelector('#snapscreen-ui-host')).toBeNull();
    expect(document.activeElement).toBe(previousFocus);
    expect(onUnexpectedDispose).not.toHaveBeenCalled();
  });

  it('rejects a replacement document after the initial frame load', () => {
    const onUnexpectedDispose = vi.fn();
    const host = new ResultFrameHost({
      onMessage: vi.fn(),
      onUnexpectedDispose,
      skipFrameNavigationForTesting: true,
    });
    const frame = host.getFrameForTesting();

    frame.dispatchEvent(new Event('load'));
    frame.dispatchEvent(new Event('load'));

    expect(host.isDisposed).toBe(true);
    expect(onUnexpectedDispose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#snapscreen-ui-host')).toBeNull();
  });

  it('fails closed when the page mutates the outer host', async () => {
    const onUnexpectedDispose = vi.fn();
    const host = new ResultFrameHost({
      onMessage: vi.fn(),
      onUnexpectedDispose,
      skipFrameNavigationForTesting: true,
    });
    const outerHost = document.querySelector<HTMLElement>('#snapscreen-ui-host')!;

    outerHost.style.setProperty('opacity', '0');
    await vi.waitFor(() => expect(host.isDisposed).toBe(true));

    expect(onUnexpectedDispose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#snapscreen-ui-host')).toBeNull();
  });

  it('reports capability registration rejection as UI unavailability', async () => {
    const onUnavailable = vi.fn();
    Object.assign(chrome.runtime, {
      sendMessage: vi.fn(async () => ({ ok: false, error: 'ui_auth_failed' })),
    });

    const host = new ResultFrameHost({
      onMessage: vi.fn(),
      onUnavailable,
    });
    await vi.waitFor(() => expect(host.isDisposed).toBe(true));

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#snapscreen-ui-host')).toBeNull();
  });

  it('reports a missing READY response after the bounded handshake timeout', async () => {
    vi.useFakeTimers();
    const onUnavailable = vi.fn();
    const host = new ResultFrameHost({
      onMessage: vi.fn(),
      onUnavailable,
      skipFrameNavigationForTesting: true,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(host.isDisposed).toBe(true);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});
