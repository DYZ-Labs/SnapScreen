import { describe, expect, it } from 'vitest';
import {
  adjustKeyboardCrop,
  clampKeyboardCrop,
  createKeyboardCrop,
  MIN_CROP_SIZE,
} from './keyboard-crop';

describe('keyboard crop geometry', () => {
  it('creates a centered selection within the viewport', () => {
    expect(createKeyboardCrop({ width: 1000, height: 600 })).toEqual({
      x: 340,
      y: 210,
      width: 320,
      height: 180,
    });
  });

  it('keeps movement within every viewport boundary', () => {
    const viewport = { width: 100, height: 80 };
    const rect = { x: 0, y: 0, width: 40, height: 30 };

    expect(adjustKeyboardCrop(rect, 'ArrowLeft', false, viewport, 50)?.x).toBe(0);
    expect(adjustKeyboardCrop(rect, 'ArrowUp', false, viewport, 50)?.y).toBe(0);
    expect(
      adjustKeyboardCrop(
        { ...rect, x: 60, y: 50 },
        'ArrowRight',
        false,
        viewport,
        50,
      ),
    ).toMatchObject({ x: 60, y: 50 });
    expect(
      adjustKeyboardCrop(
        { ...rect, x: 60, y: 50 },
        'ArrowDown',
        false,
        viewport,
        50,
      ),
    ).toMatchObject({ x: 60, y: 50 });
  });

  it('clamps keyboard resizing to minimum size and remaining viewport space', () => {
    const viewport = { width: 100, height: 80 };
    const small = { x: 10, y: 10, width: MIN_CROP_SIZE, height: MIN_CROP_SIZE };
    const large = { x: 30, y: 20, width: 70, height: 60 };

    expect(adjustKeyboardCrop(small, 'ArrowLeft', true, viewport, 50)).toMatchObject({
      width: MIN_CROP_SIZE,
    });
    expect(adjustKeyboardCrop(small, 'ArrowUp', true, viewport, 50)).toMatchObject({
      height: MIN_CROP_SIZE,
    });
    expect(adjustKeyboardCrop(large, 'ArrowRight', true, viewport, 50)).toMatchObject({
      width: 70,
    });
    expect(adjustKeyboardCrop(large, 'ArrowDown', true, viewport, 50)).toMatchObject({
      height: 60,
    });
  });

  it('reclamps an existing selection after the viewport shrinks', () => {
    expect(
      clampKeyboardCrop(
        { x: 90, y: 70, width: 80, height: 60 },
        { width: 100, height: 80 },
      ),
    ).toEqual({ x: 20, y: 20, width: 80, height: 60 });
  });

  it('does not create a selection in an unusably small viewport', () => {
    expect(createKeyboardCrop({ width: 4, height: 100 })).toBeNull();
    expect(createKeyboardCrop({ width: 100, height: 4 })).toBeNull();
  });
});
