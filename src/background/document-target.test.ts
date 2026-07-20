import { describe, expect, it } from 'vitest';
import { getDocumentMessageOptions } from './document-target';

describe('getDocumentMessageOptions', () => {
  it('targets replies to the content script document that initiated the request', () => {
    expect(getDocumentMessageOptions({ tabId: 4, documentId: 'document-7' })).toEqual({
      documentId: 'document-7',
    });
  });

  it('keeps a compatibility fallback when a document ID is unavailable', () => {
    expect(getDocumentMessageOptions({ tabId: 4 })).toEqual({});
  });
});
