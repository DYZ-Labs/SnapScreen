/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disposeSnipOverlay, startSnipOverlay } from './snip-overlay';
import {
  disposeUiRootForTesting,
  getUiHostForTesting,
  getUiRootForTesting,
} from './ui-root';

const EXPECTED_INSTRUCTION = 'Drag to select a region. Click to cancel';
const FORBIDDEN_INSTRUCTIONS = [
  'Keyboard:',
  'Escape cancels',
  'press Enter',
  'Arrow keys move',
  'Enter confirms',
  '·',
];

function uiQuery<T extends Element = HTMLElement>(selector: string): T | null {
  return getUiRootForTesting()?.querySelector<T>(selector) ?? null;
}

function expectCanonicalInstruction(): void {
  expect(uiQuery('.snapscreen-hint')?.textContent).toBe(EXPECTED_INSTRUCTION);
  const markup = getUiRootForTesting()?.innerHTML ?? '';
  for (const forbidden of FORBIDDEN_INSTRUCTIONS) {
    expect(markup).not.toContain(forbidden);
  }
}

function dispatchOverlayKey(key: string, init: KeyboardEventInit = {}): void {
  uiQuery<HTMLDivElement>('#snapscreen-overlay-root')?.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key, ...init }),
  );
}

function dispatchOverlayPointer(
  type: string,
  init: PointerEventInit,
): void {
  uiQuery<HTMLDivElement>('#snapscreen-overlay-root')?.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerId: 1, ...init }),
  );
}

function installAnimationFrameQueue(): Array<FrameRequestCallback> {
  const frames: Array<FrameRequestCallback> = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return frames;
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
});

afterEach(() => {
  disposeSnipOverlay();
  disposeUiRootForTesting();
  vi.unstubAllGlobals();
});

describe('snip overlay isolation and disposal', () => {
  it('renders into a closed shadow root and focuses the accessible dialog', () => {
    startSnipOverlay({ onRegionSelected: vi.fn(), onCancelled: vi.fn() });

    const host = getUiHostForTesting();
    const overlay = uiQuery<HTMLDivElement>('#snapscreen-overlay-root');
    expect(host?.id).toBe('snapscreen-ui-host');
    expect(host?.shadowRoot).toBeNull();
    expect(document.querySelector('#snapscreen-overlay-root')).toBeNull();
    expect(overlay?.getAttribute('role')).toBe('dialog');
    expect(overlay?.getAttribute('aria-describedby')).toBe(
      'snapscreen-overlay-instructions',
    );
    expect(getUiRootForTesting()?.activeElement).toBe(overlay);
    expectCanonicalInstruction();
  });

  it('is idempotent and does not report programmatic teardown as user cancellation', () => {
    const onCancelled = vi.fn();
    const dispose = startSnipOverlay({
      onRegionSelected: vi.fn(),
      onCancelled,
    });

    dispose();
    dispose();

    expect(getUiHostForTesting()).toBeNull();
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it('removes the previous overlay listeners before starting a new selection', () => {
    const firstCancelled = vi.fn();
    const secondCancelled = vi.fn();
    startSnipOverlay({ onRegionSelected: vi.fn(), onCancelled: firstCancelled });
    startSnipOverlay({ onRegionSelected: vi.fn(), onCancelled: secondCancelled });

    dispatchOverlayKey('Escape');

    expect(firstCancelled).not.toHaveBeenCalled();
    expect(secondCancelled).toHaveBeenCalledTimes(1);
    expect(getUiHostForTesting()).toBeNull();
  });

  it('keeps the exact instruction when snipping is reopened', () => {
    startSnipOverlay({ onRegionSelected: vi.fn(), onCancelled: vi.fn() });
    expectCanonicalInstruction();

    startSnipOverlay({ onRegionSelected: vi.fn(), onCancelled: vi.fn() });

    expectCanonicalInstruction();
  });
});

describe('keyboard crop selection', () => {
  it('creates, moves, resizes, and confirms a selection', () => {
    const frames = installAnimationFrameQueue();
    const onRegionSelected = vi.fn();
    startSnipOverlay({ onRegionSelected, onCancelled: vi.fn() });

    dispatchOverlayKey('Enter');
    const selection = uiQuery<HTMLDivElement>('.snapscreen-selection')!;
    expect(selection.hidden).toBe(false);
    expect(selection.classList).toContain('snapscreen-selection-keyboard');
    expect(selection.style.left).toBe('340px');
    expect(selection.style.top).toBe('210px');
    expectCanonicalInstruction();

    dispatchOverlayKey('ArrowRight');
    dispatchOverlayKey('ArrowDown', { shiftKey: true });
    expect(selection.style.left).toBe('350px');
    expect(selection.style.height).toBe('190px');
    expectCanonicalInstruction();

    dispatchOverlayKey('Enter');
    expect(uiQuery('#snapscreen-overlay-root')).toBeNull();
    expect(onRegionSelected).not.toHaveBeenCalled();
    frames.shift()?.(0);
    frames.shift()?.(0);

    expect(onRegionSelected).toHaveBeenCalledWith({
      x: 350,
      y: 210,
      width: 320,
      height: 190,
    });
  });

  it('keeps keyboard adjustments inside the current viewport', () => {
    startSnipOverlay({ onRegionSelected: vi.fn(), onCancelled: vi.fn() });
    dispatchOverlayKey('Enter');

    for (let index = 0; index < 100; index += 1) {
      dispatchOverlayKey('ArrowRight');
      dispatchOverlayKey('ArrowDown');
      dispatchOverlayKey('ArrowRight', { shiftKey: true });
      dispatchOverlayKey('ArrowDown', { shiftKey: true });
    }

    const selection = uiQuery<HTMLDivElement>('.snapscreen-selection')!;
    expect(Number.parseFloat(selection.style.left)).toBeLessThanOrEqual(680);
    expect(Number.parseFloat(selection.style.top)).toBeLessThanOrEqual(420);
    expect(
      Number.parseFloat(selection.style.left)
      + Number.parseFloat(selection.style.width),
    ).toBeLessThanOrEqual(1000);
    expect(
      Number.parseFloat(selection.style.top)
      + Number.parseFloat(selection.style.height),
    ).toBeLessThanOrEqual(600);
  });

  it('cancels from Escape and removes the isolated host', () => {
    const onCancelled = vi.fn();
    startSnipOverlay({ onRegionSelected: vi.fn(), onCancelled });
    dispatchOverlayKey('Enter');

    dispatchOverlayKey('Escape');

    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(getUiHostForTesting()).toBeNull();
  });

  it('keeps focus in the keyboard crop dialog when Tab is pressed', () => {
    startSnipOverlay({ onRegionSelected: vi.fn(), onCancelled: vi.fn() });
    const overlay = uiQuery<HTMLDivElement>('#snapscreen-overlay-root')!;
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
    });

    overlay.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(getUiRootForTesting()?.activeElement).toBe(overlay);
  });

  it('preserves mouse drag selection behavior through pointer events', () => {
    const frames = installAnimationFrameQueue();
    const onRegionSelected = vi.fn();
    startSnipOverlay({ onRegionSelected, onCancelled: vi.fn() });

    dispatchOverlayPointer('pointerdown', { button: 0, clientX: 25, clientY: 30 });
    dispatchOverlayPointer('pointermove', { clientX: 125, clientY: 90 });
    expectCanonicalInstruction();
    dispatchOverlayPointer('pointerup', { clientX: 125, clientY: 90 });
    frames.shift()?.(0);
    frames.shift()?.(0);

    expect(onRegionSelected).toHaveBeenCalledWith({
      x: 25,
      y: 30,
      width: 100,
      height: 60,
    });
  });

  it('cancels when a click does not create a selection', () => {
    const onRegionSelected = vi.fn();
    const onCancelled = vi.fn();
    startSnipOverlay({ onRegionSelected, onCancelled });

    dispatchOverlayPointer('pointerdown', { button: 0, clientX: 25, clientY: 30 });
    dispatchOverlayPointer('pointerup', { clientX: 25, clientY: 30 });

    expect(onRegionSelected).not.toHaveBeenCalled();
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(getUiHostForTesting()).toBeNull();
  });

  it('completes a drag after pointer capture was already lost', () => {
    const frames = installAnimationFrameQueue();
    const onRegionSelected = vi.fn();
    startSnipOverlay({ onRegionSelected, onCancelled: vi.fn() });
    const overlay = uiQuery<HTMLDivElement>('#snapscreen-overlay-root')!;
    const releasePointerCapture = vi.fn(() => {
      throw new DOMException('Pointer capture is not active.', 'NotFoundError');
    });
    Object.defineProperties(overlay, {
      hasPointerCapture: { configurable: true, value: () => false },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });

    dispatchOverlayPointer('pointerdown', { button: 0, clientX: 10, clientY: 20 });
    dispatchOverlayPointer('pointerup', { clientX: 110, clientY: 80 });
    frames.shift()?.(0);
    frames.shift()?.(0);

    expect(releasePointerCapture).not.toHaveBeenCalled();
    expect(onRegionSelected).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 100,
      height: 60,
    });
  });

  it('clamps mouse selection coordinates to the visible viewport', () => {
    const frames = installAnimationFrameQueue();
    const onRegionSelected = vi.fn();
    startSnipOverlay({ onRegionSelected, onCancelled: vi.fn() });

    dispatchOverlayPointer('pointerdown', {
      button: 0,
      clientX: 900,
      clientY: 500,
    });
    dispatchOverlayPointer('pointermove', { clientX: 1200, clientY: 800 });
    dispatchOverlayPointer('pointerup', { clientX: 1200, clientY: 800 });
    frames.shift()?.(0);
    frames.shift()?.(0);

    expect(onRegionSelected).toHaveBeenCalledWith({
      x: 900,
      y: 500,
      width: 100,
      height: 100,
    });
  });

  it('reclamps an active pointer selection after the viewport shrinks', () => {
    const frames = installAnimationFrameQueue();
    const onRegionSelected = vi.fn();
    startSnipOverlay({ onRegionSelected, onCancelled: vi.fn() });

    dispatchOverlayPointer('pointerdown', {
      button: 0,
      clientX: 900,
      clientY: 500,
    });
    dispatchOverlayPointer('pointermove', { clientX: 950, clientY: 550 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 });
    window.dispatchEvent(new Event('resize'));
    dispatchOverlayPointer('pointerup', { clientX: 680, clientY: 380 });
    frames.shift()?.(0);
    frames.shift()?.(0);

    expect(onRegionSelected).toHaveBeenCalledWith({
      x: 680,
      y: 380,
      width: 20,
      height: 20,
    });
  });

  it('ignores synthetic window events outside the closed UI root', () => {
    const onRegionSelected = vi.fn();
    const onCancelled = vi.fn();
    startSnipOverlay({ onRegionSelected, onCancelled });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 500,
      clientY: 300,
      pointerId: 1,
    }));

    expect(uiQuery<HTMLDivElement>('.snapscreen-selection')?.hidden).toBe(true);
    expect(onRegionSelected).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
