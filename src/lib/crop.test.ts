import { describe, expect, it } from 'vitest';
import { dataUrlToBase64 } from './crop';

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
