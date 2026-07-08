export const VIEWPORT_MARGIN = 16;

export interface Point {
  top: number;
  left: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampToViewport(
  preferred: Point,
  size: Size,
  viewport: Viewport,
  margin: number,
): Point {
  const maxLeft = viewport.width - size.width - margin;
  const maxTop = viewport.height - size.height - margin;

  const left =
    size.width > viewport.width - margin * 2
      ? margin
      : clamp(preferred.left, margin, Math.max(margin, maxLeft));

  const top =
    size.height > viewport.height - margin * 2
      ? margin
      : clamp(preferred.top, margin, Math.max(margin, maxTop));

  return { top, left };
}
