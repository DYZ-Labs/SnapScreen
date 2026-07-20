import { describe, expect, it } from 'vitest';
import { matchesActiveGeneration, matchesPendingCapture } from './session-correlation';

const active = {
  captureId: 'capture-1',
  requestId: 'request-2',
  screenshotId: 'screenshot-3',
};

describe('session correlation', () => {
  it('accepts only delivery for the current capture and request', () => {
    expect(matchesActiveGeneration(true, active, active)).toBe(true);
    expect(
      matchesActiveGeneration(true, active, { ...active, requestId: 'stale-request' }),
    ).toBe(false);
    expect(
      matchesActiveGeneration(true, active, { ...active, captureId: 'stale-capture' }),
    ).toBe(false);
  });

  it('rejects late delivery after a request has settled or the panel closed', () => {
    expect(matchesActiveGeneration(true, null, active)).toBe(false);
    expect(matchesActiveGeneration(false, active, active)).toBe(false);
  });

  it('accepts a cropped image only once for the pending capture', () => {
    expect(matchesPendingCapture('capture-1', true, 'capture-1')).toBe(true);
    expect(matchesPendingCapture('capture-1', false, 'capture-1')).toBe(false);
    expect(matchesPendingCapture('capture-2', true, 'capture-1')).toBe(false);
  });
});
