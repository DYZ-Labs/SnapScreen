export interface RuntimeResponseFailure {
  kind: 'aborted' | 'duplicate' | 'error' | 'stale';
  message?: string;
}

/**
 * Runtime messages resolve even when the background worker rejected or
 * cancelled the operation. Surface only explicit failure acknowledgements;
 * `{ ok: false }` may accompany an error already delivered to the page.
 */
export function getRuntimeResponseFailure(
  response: unknown,
): RuntimeResponseFailure | null {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    return null;
  }

  const value = response as Record<string, unknown>;
  if (typeof value.error === 'string') {
    return { kind: 'error', message: value.error };
  }
  if (value.aborted === true) return { kind: 'aborted' };
  if (value.stale === true) return { kind: 'stale' };
  if (value.duplicate === true) return { kind: 'duplicate' };
  return null;
}
