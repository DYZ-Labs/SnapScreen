import { describe, expect, it } from 'vitest';
import { GenerationRegistry } from './generation-registry';

describe('GenerationRegistry', () => {
  it('aborts the previous request when a newer request starts in the tab', () => {
    const registry = new GenerationRegistry();
    const first = registry.start(1, 'doc', 'capture-1', 'request-1')!;
    const second = registry.start(1, 'doc', 'capture-1', 'request-2')!;

    expect(first.controller.signal.aborted).toBe(true);
    expect(second.controller.signal.aborted).toBe(false);
    expect(registry.isCurrent(1, 'request-2')).toBe(true);
  });

  it('rejects duplicate request IDs without replacing the active request', () => {
    const registry = new GenerationRegistry();
    const first = registry.start(1, 'doc', 'capture-1', 'request-1')!;

    expect(registry.start(1, 'doc', 'capture-1', 'request-1')).toBeNull();
    expect(first.controller.signal.aborted).toBe(false);
    expect(registry.isCurrent(1, 'request-1')).toBe(true);
  });

  it('does not let stale cancellation abort a newer request', () => {
    const registry = new GenerationRegistry();
    registry.start(1, 'doc', 'capture-1', 'request-1');
    const current = registry.start(1, 'doc', 'capture-1', 'request-2')!;

    expect(registry.cancel(1, 'request-1')).toBe(false);
    expect(current.controller.signal.aborted).toBe(false);
  });

  it('does not let a stale snip cancellation abort a newer capture generation', () => {
    const registry = new GenerationRegistry();
    const current = registry.start(1, 'doc', 'capture-2', 'request-2')!;

    expect(registry.cancelCapture(1, 'capture-1')).toBe(false);
    expect(current.controller.signal.aborted).toBe(false);
    expect(registry.isCurrent(1, 'request-2')).toBe(true);
  });

  it('cancels the generation associated with the matching capture', () => {
    const registry = new GenerationRegistry();
    const current = registry.start(1, 'doc', 'capture-1', 'request-1')!;

    expect(registry.cancelCapture(1, 'capture-1')).toBe(true);
    expect(current.controller.signal.aborted).toBe(true);
    expect(registry.isCurrent(1, 'request-1')).toBe(false);
  });

  it('aborts active work and clears duplicate tracking on tab teardown', () => {
    const registry = new GenerationRegistry();
    const first = registry.start(1, 'doc', 'capture-1', 'request-1')!;

    registry.clearTab(1);

    expect(first.controller.signal.aborted).toBe(true);
    expect(registry.start(1, 'doc', 'capture-1', 'request-1')).not.toBeNull();
  });
});
