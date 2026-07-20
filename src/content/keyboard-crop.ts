import type { Rect } from '../lib/messages';

export const MIN_CROP_SIZE = 5;
export const KEYBOARD_CROP_STEP = 10;

export interface ViewportSize {
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeViewport(viewport: ViewportSize): ViewportSize {
  return {
    width: Math.max(0, Math.floor(viewport.width)),
    height: Math.max(0, Math.floor(viewport.height)),
  };
}

export function createKeyboardCrop(viewportInput: ViewportSize): Rect | null {
  const viewport = normalizeViewport(viewportInput);
  if (viewport.width < MIN_CROP_SIZE || viewport.height < MIN_CROP_SIZE) {
    return null;
  }

  const width = clamp(
    Math.round(viewport.width / 2),
    MIN_CROP_SIZE,
    Math.min(320, viewport.width),
  );
  const height = clamp(
    Math.round(viewport.height / 2),
    MIN_CROP_SIZE,
    Math.min(180, viewport.height),
  );

  return {
    x: Math.floor((viewport.width - width) / 2),
    y: Math.floor((viewport.height - height) / 2),
    width,
    height,
  };
}

export function clampKeyboardCrop(
  rect: Rect,
  viewportInput: ViewportSize,
): Rect | null {
  const viewport = normalizeViewport(viewportInput);
  if (viewport.width < MIN_CROP_SIZE || viewport.height < MIN_CROP_SIZE) {
    return null;
  }

  const width = clamp(rect.width, MIN_CROP_SIZE, viewport.width);
  const height = clamp(rect.height, MIN_CROP_SIZE, viewport.height);
  return {
    x: clamp(rect.x, 0, viewport.width - width),
    y: clamp(rect.y, 0, viewport.height - height),
    width,
    height,
  };
}

export function adjustKeyboardCrop(
  rectInput: Rect,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  resize: boolean,
  viewportInput: ViewportSize,
  step = KEYBOARD_CROP_STEP,
): Rect | null {
  const viewport = normalizeViewport(viewportInput);
  const rect = clampKeyboardCrop(rectInput, viewport);
  if (!rect) return null;

  if (resize) {
    const widthDelta = key === 'ArrowRight'
      ? step
      : key === 'ArrowLeft'
        ? -step
        : 0;
    const heightDelta = key === 'ArrowDown'
      ? step
      : key === 'ArrowUp'
        ? -step
        : 0;
    return {
      ...rect,
      width: clamp(
        rect.width + widthDelta,
        MIN_CROP_SIZE,
        viewport.width - rect.x,
      ),
      height: clamp(
        rect.height + heightDelta,
        MIN_CROP_SIZE,
        viewport.height - rect.y,
      ),
    };
  }

  const xDelta = key === 'ArrowRight'
    ? step
    : key === 'ArrowLeft'
      ? -step
      : 0;
  const yDelta = key === 'ArrowDown'
    ? step
    : key === 'ArrowUp'
      ? -step
      : 0;
  return {
    ...rect,
    x: clamp(rect.x + xDelta, 0, viewport.width - rect.width),
    y: clamp(rect.y + yDelta, 0, viewport.height - rect.height),
  };
}
