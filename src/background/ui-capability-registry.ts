const DEFAULT_TTL_MS = 15_000;

interface UiCapabilityRecord {
  documentId?: string;
  expiresAt: number;
  nonce: string;
  sessionId: string;
  tabId: number;
}

export interface UiCapabilityOwner {
  documentId?: string;
  tabId: number;
}

export class UiCapabilityRegistry {
  readonly #records = new Map<string, UiCapabilityRecord>();
  readonly #now: () => number;
  readonly #ttlMs: number;

  constructor(now: () => number = Date.now, ttlMs = DEFAULT_TTL_MS) {
    this.#now = now;
    this.#ttlMs = ttlMs;
  }

  register(
    owner: UiCapabilityOwner,
    sessionId: string,
    nonce: string,
  ): boolean {
    this.#pruneExpired();
    const key = capabilityKey(owner.tabId, sessionId);
    if (this.#records.has(key)) return false;
    this.#records.set(key, {
      ...owner,
      expiresAt: this.#now() + this.#ttlMs,
      nonce,
      sessionId,
    });
    return true;
  }

  claim(tabId: number, sessionId: string, nonce: string): boolean {
    this.#pruneExpired();
    const key = capabilityKey(tabId, sessionId);
    const record = this.#records.get(key);
    if (!record || !constantTimeEqual(record.nonce, nonce)) return false;
    this.#records.delete(key);
    return true;
  }

  revoke(owner: UiCapabilityOwner, sessionId: string): boolean {
    this.#pruneExpired();
    const key = capabilityKey(owner.tabId, sessionId);
    const record = this.#records.get(key);
    if (!record || record.documentId !== owner.documentId) return false;
    this.#records.delete(key);
    return true;
  }

  clearTab(tabId: number): void {
    for (const [key, record] of this.#records) {
      if (record.tabId === tabId) this.#records.delete(key);
    }
  }

  #pruneExpired(): void {
    const now = this.#now();
    for (const [key, record] of this.#records) {
      if (record.expiresAt <= now) this.#records.delete(key);
    }
  }
}

function capabilityKey(tabId: number, sessionId: string): string {
  return `${tabId}:${sessionId}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
