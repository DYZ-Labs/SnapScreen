import { describe, expect, it } from 'vitest';
import { clampToViewport } from './clamp-to-viewport';

const viewport = { width: 1000, height: 800 };
const margin = 16;

describe('clampToViewport', () => {
  it('keeps a position that already fits', () => {
    const result = clampToViewport(
      { top: 100, left: 200 },
      { width: 300, height: 200 },
      viewport,
      margin,
    );
    expect(result).toEqual({ top: 100, left: 200 });
  });

  it('clamps negative positions to the margin', () => {
    const result = clampToViewport(
      { top: -50, left: -10 },
      { width: 300, height: 200 },
      viewport,
      margin,
    );
    expect(result).toEqual({ top: margin, left: margin });
  });

  it('clamps positions past the bottom-right edge', () => {
    const result = clampToViewport(
      { top: 999, left: 999 },
      { width: 300, height: 200 },
      viewport,
      margin,
    );
    expect(result).toEqual({
      top: viewport.height - 200 - margin,
      left: viewport.width - 300 - margin,
    });
  });

  it('pins oversized panels to the margin instead of negative coordinates', () => {
    const result = clampToViewport(
      { top: 400, left: 400 },
      { width: 2000, height: 2000 },
      viewport,
      margin,
    );
    expect(result).toEqual({ top: margin, left: margin });
  });

  it('pins a panel exactly as wide as the usable viewport to the margin', () => {
    const result = clampToViewport(
      { top: 0, left: 500 },
      { width: viewport.width - margin * 2 + 1, height: 100 },
      viewport,
      margin,
    );
    expect(result.left).toBe(margin);
  });
});
