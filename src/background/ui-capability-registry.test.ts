import { describe, expect, it } from 'vitest';
import { UiCapabilityRegistry } from './ui-capability-registry';

describe('UI capability registry', () => {
  it('claims a registered capability exactly once', () => {
    const registry = new UiCapabilityRegistry(() => 100);
    const owner = { tabId: 7, documentId: 'top-document' };

    expect(registry.register(owner, 'session-1', 'nonce-1')).toBe(true);
    expect(registry.claim(7, 'session-1', 'nonce-1')).toBe(true);
    expect(registry.claim(7, 'session-1', 'nonce-1')).toBe(false);
  });

  it('rejects wrong nonces, cross-tab claims, and expired capabilities', () => {
    let now = 1_000;
    const registry = new UiCapabilityRegistry(() => now, 500);
    const owner = { tabId: 7, documentId: 'top-document' };

    registry.register(owner, 'session-1', 'nonce-1');
    expect(registry.claim(8, 'session-1', 'nonce-1')).toBe(false);
    expect(registry.claim(7, 'session-1', 'wrong')).toBe(false);

    now += 500;
    expect(registry.claim(7, 'session-1', 'nonce-1')).toBe(false);
  });

  it('allows only the registering top document to revoke a capability', () => {
    const registry = new UiCapabilityRegistry(() => 100);
    registry.register(
      { tabId: 7, documentId: 'top-document' },
      'session-1',
      'nonce-1',
    );

    expect(registry.revoke(
      { tabId: 7, documentId: 'other-document' },
      'session-1',
    )).toBe(false);
    expect(registry.revoke(
      { tabId: 7, documentId: 'top-document' },
      'session-1',
    )).toBe(true);
    expect(registry.claim(7, 'session-1', 'nonce-1')).toBe(false);
  });

  it('clears pending capabilities when their tab is discarded', () => {
    const registry = new UiCapabilityRegistry(() => 100);
    registry.register({ tabId: 7 }, 'session-1', 'nonce-1');
    registry.register({ tabId: 8 }, 'session-2', 'nonce-2');

    registry.clearTab(7);

    expect(registry.claim(7, 'session-1', 'nonce-1')).toBe(false);
    expect(registry.claim(8, 'session-2', 'nonce-2')).toBe(true);
  });
});
