import type { CaptureSelection, Rect } from '../lib/messages';

export interface Size {
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function getContainedImageBounds(
  viewport: Size,
  image: Size,
): Rect {
  if (
    viewport.width <= 0
    || viewport.height <= 0
    || image.width <= 0
    || image.height <= 0
  ) {
    return { x: 0, y: 0, width: viewport.width, height: viewport.height };
  }

  const scale = Math.min(
    viewport.width / image.width,
    viewport.height / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
    width,
    height,
  };
}

export function createCaptureSelection(
  viewportRect: Rect,
  imageBounds: Rect,
): CaptureSelection {
  if (imageBounds.width <= 0 || imageBounds.height <= 0) {
    throw new RangeError('The captured image has no selectable area.');
  }

  const left = clamp(viewportRect.x, imageBounds.x, imageBounds.x + imageBounds.width);
  const top = clamp(viewportRect.y, imageBounds.y, imageBounds.y + imageBounds.height);
  const right = clamp(
    viewportRect.x + viewportRect.width,
    imageBounds.x,
    imageBounds.x + imageBounds.width,
  );
  const bottom = clamp(
    viewportRect.y + viewportRect.height,
    imageBounds.y,
    imageBounds.y + imageBounds.height,
  );
  const containedRect = {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };

  return {
    viewportRect: containedRect,
    normalizedRect: {
      x: (containedRect.x - imageBounds.x) / imageBounds.width,
      y: (containedRect.y - imageBounds.y) / imageBounds.height,
      width: containedRect.width / imageBounds.width,
      height: containedRect.height / imageBounds.height,
    },
  };
}

export function denormalizeRect(normalizedRect: Rect, bounds: Rect): Rect {
  return {
    x: bounds.x + normalizedRect.x * bounds.width,
    y: bounds.y + normalizedRect.y * bounds.height,
    width: normalizedRect.width * bounds.width,
    height: normalizedRect.height * bounds.height,
  };
}
