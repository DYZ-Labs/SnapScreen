import type { Rect } from '../lib/messages';
import {
  adjustKeyboardCrop,
  clampKeyboardCrop,
  createKeyboardCrop,
  MIN_CROP_SIZE,
} from './keyboard-crop';
import {
  getUiRoot,
  queryUiElement,
  removeUiHostIfEmpty,
} from './ui-root';

const ROOT_ID = 'snapscreen-overlay-root';
const HINT_ID = 'snapscreen-overlay-instructions';
const SNIP_INSTRUCTION = 'Drag to select a region. Click to cancel';

export interface SnipOverlayOptions {
  onRegionSelected: (rect: Rect) => void;
  onCancelled: () => void;
}

export type SnipOverlayDisposer = () => void;

let disposeActiveOverlay: SnipOverlayDisposer | null = null;

function getViewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

function clampPointerToViewport(clientX: number, clientY: number): {
  x: number;
  y: number;
} {
  return {
    x: Math.min(Math.max(clientX, 0), window.innerWidth),
    y: Math.min(Math.max(clientY, 0), window.innerHeight),
  };
}

export function startSnipOverlay(options: SnipOverlayOptions): SnipOverlayDisposer {
  disposeSnipOverlay();

  const uiRoot = getUiRoot();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'snapscreen-overlay';
  root.tabIndex = 0;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Select a screen region');
  root.setAttribute('aria-describedby', HINT_ID);

  const dim = document.createElement('div');
  dim.className = 'snapscreen-dim';

  const selection = document.createElement('div');
  selection.className = 'snapscreen-selection';
  selection.hidden = true;

  const hint = document.createElement('div');
  hint.id = HINT_ID;
  hint.className = 'snapscreen-hint';
  hint.textContent = SNIP_INSTRUCTION;

  const sizeBadge = document.createElement('div');
  sizeBadge.className = 'snapscreen-size-badge';
  sizeBadge.hidden = true;

  const liveStatus = document.createElement('div');
  liveStatus.className = 'snapscreen-sr-only';
  liveStatus.setAttribute('role', 'status');
  liveStatus.setAttribute('aria-live', 'polite');

  root.append(dim, selection, sizeBadge, hint, liveStatus);
  uiRoot.append(root);

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let dragging = false;
  let activePointerId: number | null = null;
  let keyboardRect: Rect | null = null;
  let active = true;
  let firstPaintFrame: number | null = null;
  let secondPaintFrame: number | null = null;

  function describeSelection(rect: Rect): string {
    return `Selection at ${Math.round(rect.x)}, ${Math.round(rect.y)}, `
      + `${Math.round(rect.width)} by ${Math.round(rect.height)} pixels.`;
  }

  function updateSelection(rect: Rect, keyboard = false): void {
    const { x, y, width, height } = rect;
    selection.hidden = false;
    selection.classList.toggle('snapscreen-selection-keyboard', keyboard);
    selection.style.left = `${x}px`;
    selection.style.top = `${y}px`;
    selection.style.width = `${width}px`;
    selection.style.height = `${height}px`;

    sizeBadge.hidden = false;
    sizeBadge.textContent = `${Math.round(width)} × ${Math.round(height)}`;
    sizeBadge.style.left = `${Math.max(0, Math.min(x + width + 8, window.innerWidth - 90))}px`;
    sizeBadge.style.top = `${Math.max(0, Math.min(y + height + 8, window.innerHeight - 30))}px`;

    if (keyboard) liveStatus.textContent = describeSelection(rect);
  }

  function completeSelection(rect: Rect): void {
    if (rect.width < MIN_CROP_SIZE || rect.height < MIN_CROP_SIZE) {
      cancel();
      return;
    }

    teardown(false);
    firstPaintFrame = requestAnimationFrame(() => {
      firstPaintFrame = null;
      secondPaintFrame = requestAnimationFrame(() => {
        secondPaintFrame = null;
        if (!active) return;
        active = false;
        if (disposeActiveOverlay === dispose) disposeActiveOverlay = null;
        options.onRegionSelected(rect);
      });
    });
  }

  function rectFromPointer(): Rect {
    return {
      x: Math.min(startX, currentX),
      y: Math.min(startY, currentY),
      width: Math.abs(currentX - startX),
      height: Math.abs(currentY - startY),
    };
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || activePointerId !== null) return;
    dragging = true;
    activePointerId = e.pointerId;
    keyboardRect = null;
    selection.classList.remove('snapscreen-selection-keyboard');
    const start = clampPointerToViewport(e.clientX, e.clientY);
    startX = start.x;
    startY = start.y;
    currentX = start.x;
    currentY = start.y;
    updateSelection({ x: startX, y: startY, width: 0, height: 0 });
    root.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== activePointerId) return;
    const pointer = clampPointerToViewport(e.clientX, e.clientY);
    currentX = pointer.x;
    currentY = pointer.y;
    updateSelection(rectFromPointer());
  }

  function cancel(): void {
    if (!active) return;
    teardown(true);
    options.onCancelled();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging || e.pointerId !== activePointerId) return;
    dragging = false;

    const pointer = clampPointerToViewport(e.clientX, e.clientY);
    currentX = pointer.x;
    currentY = pointer.y;
    if (root.hasPointerCapture?.(e.pointerId)) {
      root.releasePointerCapture?.(e.pointerId);
    }
    activePointerId = null;
    completeSelection(rectFromPointer());
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    cancel();
  }

  function consumeKeyboardEvent(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
      consumeKeyboardEvent(e);
      root.focus({ preventScroll: true });
      return;
    }
    if (e.key === 'Escape') {
      consumeKeyboardEvent(e);
      cancel();
      return;
    }
    if (dragging) return;

    if (e.key === 'Enter') {
      consumeKeyboardEvent(e);
      if (e.repeat) return;
      if (!keyboardRect) {
        keyboardRect = createKeyboardCrop(getViewport());
        if (keyboardRect) updateSelection(keyboardRect, true);
        return;
      }
      completeSelection(keyboardRect);
      return;
    }

    if (
      e.key !== 'ArrowLeft'
      && e.key !== 'ArrowRight'
      && e.key !== 'ArrowUp'
      && e.key !== 'ArrowDown'
    ) {
      return;
    }

    consumeKeyboardEvent(e);
    if (!keyboardRect) return;
    keyboardRect = adjustKeyboardCrop(
      keyboardRect,
      e.key,
      e.shiftKey,
      getViewport(),
    );
    if (keyboardRect) updateSelection(keyboardRect, true);
  }

  function onResize(): void {
    if (dragging) {
      const start = clampPointerToViewport(startX, startY);
      const current = clampPointerToViewport(currentX, currentY);
      startX = start.x;
      startY = start.y;
      currentX = current.x;
      currentY = current.y;
      updateSelection(rectFromPointer());
    }
    if (!keyboardRect) return;
    keyboardRect = clampKeyboardCrop(keyboardRect, getViewport());
    if (keyboardRect) {
      updateSelection(keyboardRect, true);
    } else {
      selection.hidden = true;
      sizeBadge.hidden = true;
    }
  }

  function teardown(cancelPendingSelection: boolean): void {
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel);
    root.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    root.style.display = 'none';
    root.remove();
    removeUiHostIfEmpty();

    if (cancelPendingSelection) {
      active = false;
      if (firstPaintFrame !== null) cancelAnimationFrame(firstPaintFrame);
      if (secondPaintFrame !== null) cancelAnimationFrame(secondPaintFrame);
      firstPaintFrame = null;
      secondPaintFrame = null;
      if (disposeActiveOverlay === dispose) disposeActiveOverlay = null;
    }
  }

  function dispose(): void {
    if (!active) return;
    teardown(true);
  }

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
  root.focus({ preventScroll: true });

  disposeActiveOverlay = dispose;
  return dispose;
}

export function disposeSnipOverlay(): void {
  disposeActiveOverlay?.();
  disposeActiveOverlay = null;
  queryUiElement(`#${ROOT_ID}`)?.remove();
  removeUiHostIfEmpty();
}
