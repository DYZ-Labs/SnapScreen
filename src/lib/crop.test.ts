import { afterEach, describe, expect, it, vi } from 'vitest';
import { cropImage, dataUrlToBase64 } from './crop';

interface CropMocks {
  bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
  convertToBlob: ReturnType<typeof vi.fn>;
  createImageBitmap: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  canvases: Array<{ width: number; height: number }>;
}

function installCropMocks(options: { context?: boolean; convertError?: Error } = {}): CropMocks {
  const bitmap = { width: 200, height: 200, close: vi.fn() };
  const drawImage = vi.fn();
  const convertToBlob = options.convertError
    ? vi.fn(async () => Promise.reject(options.convertError))
    : vi.fn(async () => new Blob(['cropped'], { type: 'image/png' }));
  const canvases: Array<{ width: number; height: number }> = [];
  const createBitmap = vi.fn(async () => bitmap);

  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['source']))));
  vi.stubGlobal('createImageBitmap', createBitmap);
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {
        canvases.push({ width, height });
      }

      getContext(): { drawImage: ReturnType<typeof vi.fn> } | null {
        return options.context === false ? null : { drawImage };
      }

      convertToBlob(): Promise<Blob> {
        return convertToBlob();
      }
    },
  );
  vi.stubGlobal(
    'FileReader',
    class {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsDataURL(): void {
        this.result = 'data:image/png;base64,Q1JPUEVERA==';
        this.onload?.();
      }
    },
  );

  return {
    bitmap,
    convertToBlob,
    createImageBitmap: createBitmap,
    drawImage,
    canvases,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cropImage', () => {
  it('intersects scaled crop bounds with the captured image', async () => {
    const mocks = installCropMocks();

    const result = await cropImage(
      'data:image/png;base64,U09VUkNF',
      { x: -5, y: 95, width: 20, height: 20 },
      2,
    );

    expect(result).toBe('data:image/png;base64,Q1JPUEVERA==');
    expect(mocks.canvases).toEqual([{ width: 30, height: 10 }]);
    expect(mocks.drawImage).toHaveBeenCalledWith(
      mocks.bitmap,
      0,
      190,
      30,
      10,
      0,
      0,
      30,
      10,
    );
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
  });

  it('rejects crops outside the image and still closes the bitmap', async () => {
    const mocks = installCropMocks();

    await expect(
      cropImage(
        'data:image/png;base64,U09VUkNF',
        { x: 101, y: 10, width: 20, height: 20 },
        2,
      ),
    ).rejects.toThrow('does not intersect');
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
  });

  it('closes the bitmap when canvas setup fails', async () => {
    const mocks = installCropMocks({ context: false });

    await expect(
      cropImage(
        'data:image/png;base64,U09VUkNF',
        { x: 10, y: 10, width: 20, height: 20 },
        2,
      ),
    ).rejects.toThrow('Failed to get canvas context');
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
  });

  it('closes the bitmap when PNG conversion fails', async () => {
    const mocks = installCropMocks({ convertError: new Error('conversion failed') });

    await expect(
      cropImage(
        'data:image/png;base64,U09VUkNF',
        { x: 10, y: 10, width: 20, height: 20 },
        2,
      ),
    ).rejects.toThrow('conversion failed');
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
  });

  it('rejects invalid dimensions before allocating image resources', async () => {
    const mocks = installCropMocks();

    await expect(
      cropImage(
        'data:image/png;base64,U09VUkNF',
        { x: 0, y: 0, width: 0, height: 20 },
        2,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(mocks.createImageBitmap).not.toHaveBeenCalled();
  });
});

describe('dataUrlToBase64', () => {
  it('strips the data-url prefix', () => {
    expect(dataUrlToBase64('data:image/png;base64,QUJDRA==')).toBe('QUJDRA==');
  });

  it('returns input without a comma unchanged', () => {
    expect(dataUrlToBase64('QUJDRA==')).toBe('QUJDRA==');
  });

  it('splits on the first comma only', () => {
    expect(dataUrlToBase64('data:image/png;base64,QUJD,RA==')).toBe('QUJD,RA==');
  });
});
