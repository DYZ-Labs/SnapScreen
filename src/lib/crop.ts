import type { Rect } from './messages';

export async function cropImage(
  dataUrl: string,
  rect: Rect,
  devicePixelRatio: number,
): Promise<string> {
  validateCropRequest(rect, devicePixelRatio);

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  try {
    const requestedLeft = Math.round(rect.x * devicePixelRatio);
    const requestedTop = Math.round(rect.y * devicePixelRatio);
    const requestedRight = Math.round((rect.x + rect.width) * devicePixelRatio);
    const requestedBottom = Math.round((rect.y + rect.height) * devicePixelRatio);
    if (
      ![requestedLeft, requestedTop, requestedRight, requestedBottom].every(Number.isFinite)
    ) {
      throw new RangeError('Crop rectangle is outside the supported coordinate range.');
    }

    const sx = clamp(requestedLeft, 0, bitmap.width);
    const sy = clamp(requestedTop, 0, bitmap.height);
    const right = clamp(requestedRight, 0, bitmap.width);
    const bottom = clamp(requestedBottom, 0, bitmap.height);
    const sw = right - sx;
    const sh = bottom - sy;
    if (sw <= 0 || sh <= 0) {
      throw new RangeError('Crop rectangle does not intersect the captured image.');
    }

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

    const cropped = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToDataUrl(cropped);
  } finally {
    bitmap.close();
  }
}

function validateCropRequest(rect: Rect, devicePixelRatio: number): void {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    !Number.isFinite(devicePixelRatio) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    devicePixelRatio <= 0
  ) {
    throw new RangeError('Crop rectangle and device pixel ratio must be finite and positive.');
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}
