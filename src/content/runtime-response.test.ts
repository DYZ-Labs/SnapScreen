import { describe, expect, it } from 'vitest';
import { getRuntimeResponseFailure } from './runtime-response';

describe('runtime response failures', () => {
  it('recognizes explicit cancellation, stale, duplicate, and error responses', () => {
    expect(getRuntimeResponseFailure({ ok: false, aborted: true })).toEqual({
      kind: 'aborted',
    });
    expect(getRuntimeResponseFailure({ ok: false, stale: true })).toEqual({
      kind: 'stale',
    });
    expect(getRuntimeResponseFailure({ ok: false, duplicate: true })).toEqual({
      kind: 'duplicate',
    });
    expect(getRuntimeResponseFailure({ error: 'No tab context' })).toEqual({
      kind: 'error',
      message: 'No tab context',
    });
  });

  it('ignores successful and generic responses handled by page messages', () => {
    expect(getRuntimeResponseFailure({ ok: true })).toBeNull();
    expect(getRuntimeResponseFailure({ ok: false })).toBeNull();
    expect(getRuntimeResponseFailure(undefined)).toBeNull();
  });
});
