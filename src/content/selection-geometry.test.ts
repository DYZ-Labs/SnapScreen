import { describe, expect, it } from 'vitest';
import {
  createCaptureSelection,
  denormalizeRect,
  getContainedImageBounds,
} from './selection-geometry';

describe('selection geometry', () => {
  it('letterboxes a captured image without distorting its aspect ratio', () => {
    expect(getContainedImageBounds(
      { width: 1_000, height: 600 },
      { width: 1_600, height: 900 },
    )).toEqual({
      x: 0,
      y: 18.75,
      width: 1_000,
      height: 562.5,
    });

    expect(getContainedImageBounds(
      { width: 600, height: 1_000 },
      { width: 1_600, height: 900 },
    )).toEqual({
      x: 0,
      y: 331.25,
      width: 600,
      height: 337.5,
    });
  });

  it('maps a viewport selection into normalized image coordinates', () => {
    expect(createCaptureSelection(
      { x: 100, y: 75, width: 400, height: 225 },
      { x: 0, y: 18.75, width: 1_000, height: 562.5 },
    )).toEqual({
      viewportRect: { x: 100, y: 75, width: 400, height: 225 },
      normalizedRect: {
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.4,
      },
    });
  });

  it('clamps pointer geometry to the displayed image instead of letterboxing', () => {
    expect(createCaptureSelection(
      { x: -50, y: 0, width: 1_100, height: 620 },
      { x: 0, y: 18.75, width: 1_000, height: 562.5 },
    )).toEqual({
      viewportRect: { x: 0, y: 18.75, width: 1_000, height: 562.5 },
      normalizedRect: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it('preserves normalized keyboard geometry across workspace resizing', () => {
    const originalBounds = getContainedImageBounds(
      { width: 1_000, height: 600 },
      { width: 1_600, height: 900 },
    );
    const original = { x: 250, y: 159.375, width: 500, height: 281.25 };
    const normalized = createCaptureSelection(original, originalBounds).normalizedRect;
    const resizedBounds = getContainedImageBounds(
      { width: 800, height: 800 },
      { width: 1_600, height: 900 },
    );

    expect(denormalizeRect(normalized, resizedBounds)).toEqual({
      x: 200,
      y: 287.5,
      width: 400,
      height: 225,
    });
  });

  it('uses the viewport as a safe fallback until image dimensions are known', () => {
    expect(getContainedImageBounds(
      { width: 900, height: 500 },
      { width: 0, height: 0 },
    )).toEqual({ x: 0, y: 0, width: 900, height: 500 });
  });
});
