import { describe, expect, it, vi } from 'vitest';
import { SessionDisposalGuard } from './session-disposal';

describe('SessionDisposalGuard', () => {
  it('runs teardown only once for each session', () => {
    const guard = new SessionDisposalGuard();
    const teardown = vi.fn();

    guard.begin();
    expect(guard.dispose(teardown)).toBe(true);
    expect(guard.dispose(teardown)).toBe(false);
    expect(teardown).toHaveBeenCalledTimes(1);

    guard.begin();
    expect(guard.dispose(teardown)).toBe(true);
    expect(teardown).toHaveBeenCalledTimes(2);
  });
});
