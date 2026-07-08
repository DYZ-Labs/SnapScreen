import type { Rect } from './messages';

export async function cropImage(
  dataUrl: string,
  rect: Rect,
  devicePixelRatio: number,
): Promise<string> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const scale = devicePixelRatio;
  const sx = Math.min(Math.max(0, Math.round(rect.x * scale)), bitmap.width - 1);
  const sy = Math.min(Math.max(0, Math.round(rect.y * scale)), bitmap.height - 1);
  const sw = Math.max(1, Math.min(Math.round(rect.width * scale), bitmap.width - sx));
  const sh = Math.max(1, Math.min(Math.round(rect.height * scale), bitmap.height - sy));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  const cropped = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(cropped);
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
