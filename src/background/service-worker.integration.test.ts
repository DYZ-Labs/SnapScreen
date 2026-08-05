import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CsToBgMessage } from '../lib/messages';
import {
  UI_CLAIM_CAPABILITY,
  UI_REGISTER_CAPABILITY,
  type UiAttestationMessage,
} from '../lib/ui-protocol';

const dependencies = vi.hoisted(() => ({
  analyzeImage: vi.fn(),
  cropImage: vi.fn(),
  followUp: vi.fn(),
  getSettings: vi.fn(),
  initializeStorageAccess: vi.fn(),
}));

const testLimits = {
  maxInputCharacters: 4_000,
  maxScreenshotBytes: 5_242_880,
  maxScreenshotDimension: 2_576,
  maxConversationTurns: 12,
};

vi.mock('../content/index.ts?script&iife', () => ({ default: 'content-script.js' }));
vi.mock('../content/overlay.css?inline', () => ({ default: '/* content styles */' }));
vi.mock('../lib/crop', () => ({ cropImage: dependencies.cropImage }));
vi.mock('../lib/storage', () => ({
  getSettings: dependencies.getSettings,
  initializeStorageAccess: dependencies.initializeStorageAccess,
  normalizeLimits: (limits: unknown) => limits,
}));
vi.mock('../lib/anthropic', () => ({
  analyzeImage: dependencies.analyzeImage,
  followUp: dependencies.followUp,
  AnthropicError: class AnthropicError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

class FakeEvent<TArgs extends unknown[]> {
  readonly listeners: Array<(...args: TArgs) => unknown> = [];

  addListener = (listener: (...args: TArgs) => unknown): void => {
    this.listeners.push(listener);
  };

  emit(...args: TArgs): unknown[] {
    return this.listeners.map((listener) => listener(...args));
  }
}

interface WorkerHarness {
  actionClicked: FakeEvent<[chrome.tabs.Tab]>;
  command: FakeEvent<[string, chrome.tabs.Tab]>;
  installed: FakeEvent<[chrome.runtime.InstalledDetails]>;
  message: FakeEvent<[
    unknown,
    chrome.runtime.MessageSender,
    (response?: unknown) => void,
  ]>;
  removed: FakeEvent<[number, chrome.tabs.OnRemovedInfo]>;
  updated: FakeEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>;
  tabs: {
    captureVisibleTab: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
  action: {
    setBadgeText: ReturnType<typeof vi.fn>;
    setTitle: ReturnType<typeof vi.fn>;
  };
  scripting: {
    executeScript: ReturnType<typeof vi.fn>;
    insertCSS: ReturnType<typeof vi.fn>;
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function trustedSender(overrides: Partial<chrome.runtime.MessageSender> = {}): chrome.runtime.MessageSender {
  return {
    id: 'test-extension',
    documentId: 'document-1',
    frameId: 0,
    origin: 'https://example.test',
    url: 'https://example.test/question',
    tab: {
      id: 7,
      index: 0,
      pinned: false,
      highlighted: true,
      active: true,
      incognito: false,
      selected: true,
      discarded: false,
      frozen: false,
      autoDiscardable: true,
      groupId: -1,
      windowId: 2,
      url: 'https://example.test/question',
    },
    ...overrides,
  };
}

function trustedUiFrameSender(
  overrides: Partial<chrome.runtime.MessageSender> = {},
): chrome.runtime.MessageSender {
  return trustedSender({
    documentId: 'ui-document-1',
    frameId: 4,
    origin: 'chrome-extension://test-extension',
    url: 'chrome-extension://test-extension/src/ui/result-frame.html',
    ...overrides,
  });
}

async function loadWorker(): Promise<WorkerHarness> {
  vi.resetModules();

  const installed = new FakeEvent<[chrome.runtime.InstalledDetails]>();
  const actionClicked = new FakeEvent<[chrome.tabs.Tab]>();
  const command = new FakeEvent<[string, chrome.tabs.Tab]>();
  const message = new FakeEvent<[
    unknown,
    chrome.runtime.MessageSender,
    (response?: unknown) => void,
  ]>();
  const removed = new FakeEvent<[number, chrome.tabs.OnRemovedInfo]>();
  const activated = new FakeEvent<[chrome.tabs.OnActivatedInfo]>();
  const updated = new FakeEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>();

  const tabs = {
    captureVisibleTab: vi.fn(async () => 'data:image/png;base64,FULL'),
    query: vi.fn(async () => [{ id: 7, windowId: 2, active: true }]),
    sendMessage: vi.fn(async () => undefined),
  };
  const action = {
    setBadgeText: vi.fn(async () => undefined),
    setTitle: vi.fn(async () => undefined),
  };
  const scripting = {
    executeScript: vi.fn(async () => [{
      documentId: 'document-1',
      frameId: 0,
      result: undefined,
    }]),
    insertCSS: vi.fn(async () => undefined),
  };

  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      onInstalled: installed,
      onMessage: message,
      openOptionsPage: vi.fn(async () => undefined),
    },
    action: {
      onClicked: actionClicked,
      ...action,
    },
    commands: { onCommand: command },
    scripting,
    tabs: {
      ...tabs,
      onActivated: activated,
      onRemoved: removed,
      onUpdated: updated,
    },
  });

  await import('./service-worker');
  expect(message.listeners).toHaveLength(1);

  return {
    actionClicked,
    action,
    command,
    installed,
    message,
    removed,
    scripting,
    updated,
    tabs,
  };
}

function dispatch(
  harness: WorkerHarness,
  request: CsToBgMessage | UiAttestationMessage,
  sender = trustedSender(),
): Promise<unknown> {
  const listener = harness.message.listeners[0];
  if (!listener) throw new Error('Background message listener was not registered.');

  return new Promise((resolve, reject) => {
    let responded = false;
    const timeout = setTimeout(
      () => reject(new Error(`Background did not respond to ${request.type}.`)),
      2_000,
    );
    const sendResponse = (response?: unknown): void => {
      if (responded) return;
      responded = true;
      clearTimeout(timeout);
      resolve(response);
    };

    const keepChannelOpen = listener(request, sender, sendResponse);
    if (keepChannelOpen !== true && !responded) {
      clearTimeout(timeout);
      resolve(undefined);
    }
  });
}

function captureRequest(
  captureId: string,
): Extract<CsToBgMessage, { type: 'CAPTURE_REGION' }> {
  return {
    type: 'CAPTURE_REGION',
    captureId,
    dataUrl: `data:image/png;base64,FULL_${captureId}`,
    devicePixelRatio: 2,
    rect: { x: 10, y: 20, width: 100, height: 50 },
  };
}

function analyzeRequest(
  captureId: string,
  requestId: string,
  dataUrl = `data:image/png;base64,${requestId}`,
  sessionSettings = {
    defaultPrompt: 'Answer the question.',
    limits: testLimits,
  },
): CsToBgMessage {
  return {
    type: 'ANALYZE',
    captureId,
    dataUrl,
    requestId,
    screenshotId: `screenshot-${captureId}`,
    sessionSettings,
  };
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const abort = (): void => {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

beforeEach(() => {
  dependencies.analyzeImage.mockReset().mockResolvedValue({
    history: [],
    text: 'Answer',
  });
  dependencies.cropImage.mockReset().mockResolvedValue(
    'data:image/png;base64,CROPPED',
  );
  dependencies.followUp.mockReset().mockResolvedValue({
    history: [],
    text: 'Follow-up answer',
  });
  dependencies.getSettings.mockReset().mockResolvedValue({
    apiKey: 'sk-ant-test-secret',
    defaultPrompt: 'Answer the question.',
    limits: testLimits,
  });
  dependencies.initializeStorageAccess.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.unstubAllGlobals();
});

describe('service worker message integration', () => {
  it('uses the initiating session settings for analysis and follow-ups', async () => {
    const harness = await loadWorker();
    const sessionSettings = {
      defaultPrompt: 'Keep the original session guidance.',
      limits: {
        ...testLimits,
        maxInputCharacters: 1_500,
        maxConversationTurns: 4,
      },
    };
    dependencies.getSettings.mockResolvedValue({
      apiKey: 'sk-ant-current-secret',
      defaultPrompt: 'Changed after the snip started.',
      limits: {
        ...testLimits,
        maxInputCharacters: 100,
        maxConversationTurns: 2,
      },
    });

    await dispatch(harness, analyzeRequest(
      'capture-session',
      'request-analyze-session',
      'data:image/png;base64,SESSION',
      sessionSettings,
    ));

    expect(dependencies.analyzeImage).toHaveBeenCalledWith(
      'sk-ant-current-secret',
      'data:image/png;base64,SESSION',
      expect.objectContaining({
        hiddenInstruction: sessionSettings.defaultPrompt,
        limits: sessionSettings.limits,
      }),
    );

    const history = [
      { role: 'user' as const, content: 'Initial question' },
      { role: 'assistant' as const, content: 'Initial answer' },
    ];
    await dispatch(harness, {
      type: 'FOLLOW_UP',
      captureId: 'capture-session',
      history,
      requestId: 'request-follow-up-session',
      screenshotId: 'screenshot-capture-session',
      sessionSettings,
      text: 'Why?',
    });

    expect(dependencies.followUp).toHaveBeenCalledWith(
      'sk-ant-current-secret',
      'Why?',
      history,
      expect.objectContaining({
        sessionInstruction: sessionSettings.defaultPrompt,
        limits: sessionSettings.limits,
      }),
    );
    expect(JSON.stringify(sessionSettings)).not.toContain('sk-ant-current-secret');
  });

  it('correlates capture delivery to the initiating document', async () => {
    const harness = await loadWorker();

    await expect(dispatch(harness, captureRequest('capture-1'))).resolves.toEqual({
      ok: true,
    });

    expect(harness.tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(dependencies.cropImage).toHaveBeenCalledWith(
      'data:image/png;base64,FULL_capture-1',
      { x: 10, y: 20, width: 100, height: 50 },
      2,
    );
    expect(harness.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      {
        type: 'CROPPED_IMAGE',
        captureId: 'capture-1',
        dataUrl: 'data:image/png;base64,CROPPED',
      },
      { documentId: 'document-1' },
    );
  });

  it('drops an in-flight capture when the tab starts navigating', async () => {
    const crop = deferred<string>();
    const harness = await loadWorker();
    dependencies.cropImage.mockReturnValueOnce(crop.promise);

    const response = dispatch(harness, captureRequest('capture-before-navigation'));
    await vi.waitFor(() => expect(dependencies.cropImage).toHaveBeenCalledOnce());

    harness.updated.emit(
      7,
      { status: 'loading' },
      trustedSender().tab!,
    );
    crop.resolve('data:image/png;base64,OLD_PAGE');

    await expect(response).resolves.toEqual({ ok: false, stale: true });
    expect(harness.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('delivers only the newest overlapping capture', async () => {
    const firstCrop = deferred<string>();
    const harness = await loadWorker();
    dependencies.cropImage
      .mockReturnValueOnce(firstCrop.promise)
      .mockResolvedValueOnce('data:image/png;base64,CROP_SECOND');

    const firstResponse = dispatch(harness, captureRequest('capture-1'));
    await vi.waitFor(() => expect(dependencies.cropImage).toHaveBeenCalledOnce());
    const secondResponse = dispatch(harness, captureRequest('capture-2'));

    await expect(secondResponse).resolves.toEqual({ ok: true });
    firstCrop.resolve('data:image/png;base64,CROP_FIRST');
    await expect(firstResponse).resolves.toEqual({ ok: false, stale: true });

    expect(harness.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(harness.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'CROPPED_IMAGE',
        captureId: 'capture-2',
        dataUrl: 'data:image/png;base64,CROP_SECOND',
      }),
      { documentId: 'document-1' },
    );
  });

  it('cancels the matching generation on request and acknowledges the abort', async () => {
    const harness = await loadWorker();
    dependencies.analyzeImage.mockImplementation(
      async (_apiKey: string, _dataUrl: string, options: { signal: AbortSignal }) =>
        rejectWhenAborted(options.signal),
    );

    const analysis = dispatch(
      harness,
      analyzeRequest('capture-1', 'request-1'),
    );
    await vi.waitFor(() => expect(dependencies.analyzeImage).toHaveBeenCalledOnce());

    await expect(dispatch(harness, {
      type: 'CANCEL_GENERATION',
      captureId: 'capture-1',
      requestId: 'request-1',
    })).resolves.toEqual({ ok: true });
    await expect(analysis).resolves.toEqual({ ok: false, aborted: true });
    expect(harness.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('aborts active generation work when its tab closes', async () => {
    const harness = await loadWorker();
    dependencies.analyzeImage.mockImplementation(
      async (_apiKey: string, _dataUrl: string, options: { signal: AbortSignal }) =>
        rejectWhenAborted(options.signal),
    );

    const analysis = dispatch(
      harness,
      analyzeRequest('capture-1', 'request-tab-close'),
    );
    await vi.waitFor(() => expect(dependencies.analyzeImage).toHaveBeenCalledOnce());

    harness.removed.emit(7, { isWindowClosing: false, windowId: 2 });

    await expect(analysis).resolves.toEqual({ ok: false, aborted: true });
    expect(harness.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('acknowledges a generation abort when its document starts navigating', async () => {
    const harness = await loadWorker();
    dependencies.analyzeImage.mockImplementation(
      async (_apiKey: string, _dataUrl: string, options: { signal: AbortSignal }) =>
        rejectWhenAborted(options.signal),
    );

    const analysis = dispatch(
      harness,
      analyzeRequest('capture-1', 'request-navigation'),
    );
    await vi.waitFor(() => expect(dependencies.analyzeImage).toHaveBeenCalledOnce());

    harness.updated.emit(
      7,
      { status: 'loading', url: 'https://example.test/next-question' },
      trustedSender().tab!,
    );

    await expect(analysis).resolves.toEqual({ ok: false, aborted: true });
    expect(harness.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps generation alive across same-document URL updates', async () => {
    const result = deferred<{ text: string; history: [] }>();
    const harness = await loadWorker();
    dependencies.analyzeImage.mockReturnValueOnce(result.promise);

    const analysis = dispatch(
      harness,
      analyzeRequest('capture-1', 'request-same-document'),
    );
    await vi.waitFor(() => expect(dependencies.analyzeImage).toHaveBeenCalledOnce());

    harness.updated.emit(
      7,
      { url: 'https://example.test/question#solution' },
      trustedSender().tab!,
    );
    result.resolve({ text: 'Still valid', history: [] });

    await expect(analysis).resolves.toEqual({ ok: true });
    expect(harness.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'ANALYZE_RESULT',
        text: 'Still valid',
      }),
      { documentId: 'document-1' },
    );
  });

  it('stops generation when delivery to the originating document fails', async () => {
    const harness = await loadWorker();
    harness.tabs.sendMessage.mockRejectedValueOnce(new Error('Document is gone'));
    dependencies.analyzeImage.mockImplementation(
      async (
        _apiKey: string,
        _dataUrl: string,
        options: { signal: AbortSignal; onDelta?: (text: string) => void },
      ) => {
        options.onDelta?.('Partial answer');
        return rejectWhenAborted(options.signal);
      },
    );

    const analysis = dispatch(
      harness,
      analyzeRequest('capture-1', 'request-delivery-failure'),
    );

    await expect(analysis).resolves.toEqual({ ok: false, aborted: true });
    expect(harness.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'ANALYZE_CHUNK',
        captureId: 'capture-1',
        requestId: 'request-delivery-failure',
      }),
      { documentId: 'document-1' },
    );
  });

  it('does not let a stale snip cancellation abort a newer capture generation', async () => {
    const result = deferred<{ history: []; text: string }>();
    const harness = await loadWorker();
    dependencies.analyzeImage.mockReturnValueOnce(result.promise);

    const analysis = dispatch(
      harness,
      analyzeRequest('capture-new', 'request-new'),
    );
    await vi.waitFor(() => expect(dependencies.analyzeImage).toHaveBeenCalledOnce());

    await expect(dispatch(harness, {
      type: 'SNIP_CANCELLED',
      captureId: 'capture-old',
    })).resolves.toEqual({ ok: true });
    result.resolve({ history: [], text: 'New answer' });

    await expect(analysis).resolves.toEqual({ ok: true });
    expect(harness.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'ANALYZE_RESULT',
        captureId: 'capture-new',
        requestId: 'request-new',
        text: 'New answer',
      }),
      { documentId: 'document-1' },
    );
  });

  it('aborts an older overlapping generation and delivers only the newer result', async () => {
    const harness = await loadWorker();
    dependencies.analyzeImage.mockImplementation(
      async (
        _apiKey: string,
        dataUrl: string,
        options: { signal: AbortSignal },
      ) => {
        if (dataUrl.includes('request-old')) {
          return rejectWhenAborted(options.signal);
        }
        return { history: [], text: 'Newest answer' };
      },
    );

    const older = dispatch(
      harness,
      analyzeRequest('capture-1', 'request-old'),
    );
    await vi.waitFor(() => expect(dependencies.analyzeImage).toHaveBeenCalledOnce());
    const newer = dispatch(
      harness,
      analyzeRequest('capture-1', 'request-new'),
    );

    await expect(older).resolves.toEqual({ ok: false, aborted: true });
    await expect(newer).resolves.toEqual({ ok: true });
    const resultMessages = harness.tabs.sendMessage.mock.calls
      .map((call) => call[1] as { type?: string; requestId?: string })
      .filter((message) => message.type === 'ANALYZE_RESULT');
    expect(resultMessages).toEqual([
      expect.objectContaining({ requestId: 'request-new' }),
    ]);
  });

  it('ignores messages that do not originate from this extension', async () => {
    const harness = await loadWorker();
    const sender = trustedSender({ id: 'untrusted-extension' });

    await expect(
      dispatch(harness, captureRequest('capture-untrusted'), sender),
    ).resolves.toBeUndefined();
    expect(harness.tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(dependencies.analyzeImage).not.toHaveBeenCalled();
  });

  it('rejects normal worker commands from a web-accessible extension frame', async () => {
    const harness = await loadWorker();

    await expect(dispatch(
      harness,
      captureRequest('capture-from-war-frame'),
      trustedUiFrameSender(),
    )).resolves.toBeUndefined();

    expect(harness.tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(dependencies.cropImage).not.toHaveBeenCalled();
  });

  it('attests a registered UI capability once in the same tab', async () => {
    const harness = await loadWorker();
    const nonce = 'a'.repeat(43);
    const register: UiAttestationMessage = {
      type: UI_REGISTER_CAPABILITY,
      sessionId: 'session-attested',
      nonce,
    };
    const claim: UiAttestationMessage = {
      type: UI_CLAIM_CAPABILITY,
      sessionId: 'session-attested',
      nonce,
    };

    await expect(dispatch(harness, register)).resolves.toEqual({ ok: true });
    await expect(dispatch(
      harness,
      claim,
      trustedUiFrameSender(),
    )).resolves.toEqual({ ok: true });
    await expect(dispatch(
      harness,
      claim,
      trustedUiFrameSender({ documentId: 'ui-replay-document' }),
    )).resolves.toEqual({ ok: false, error: 'ui_auth_failed' });
  });

  it('rejects unregistered, cross-tab, and wrong-context UI claims generically', async () => {
    const harness = await loadWorker();
    const nonce = 'b'.repeat(43);
    const claim: UiAttestationMessage = {
      type: UI_CLAIM_CAPABILITY,
      sessionId: 'session-isolated',
      nonce,
    };

    await expect(dispatch(
      harness,
      claim,
      trustedUiFrameSender(),
    )).resolves.toEqual({ ok: false, error: 'ui_auth_failed' });

    await expect(dispatch(harness, {
      type: UI_REGISTER_CAPABILITY,
      sessionId: 'session-isolated',
      nonce,
    })).resolves.toEqual({ ok: true });

    const otherTab = {
      ...trustedSender().tab!,
      id: 8,
    };
    await expect(dispatch(
      harness,
      claim,
      trustedUiFrameSender({ tab: otherTab }),
    )).resolves.toEqual({ ok: false, error: 'ui_auth_failed' });
    await expect(dispatch(
      harness,
      claim,
      trustedSender(),
    )).resolves.toEqual({ ok: false, error: 'ui_auth_failed' });
    await expect(dispatch(
      harness,
      {
        type: UI_REGISTER_CAPABILITY,
        sessionId: 'frame-cannot-register',
        nonce,
      },
      trustedUiFrameSender(),
    )).resolves.toEqual({ ok: false, error: 'ui_auth_failed' });

    // Failed claims do not consume the valid capability.
    await expect(dispatch(
      harness,
      claim,
      trustedUiFrameSender(),
    )).resolves.toEqual({ ok: true });
  });

  it('starts snipping from one cold toolbar invocation', async () => {
    const harness = await loadWorker();
    const tab = trustedSender().tab!;

    harness.actionClicked.emit(tab);
    await vi.waitFor(() => {
      expect(harness.tabs.sendMessage).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          type: 'START_SNIP',
          dataUrl: 'data:image/png;base64,FULL',
          hasApiKey: true,
          defaultPrompt: 'Answer the question.',
          limits: testLimits,
        }),
        { documentId: 'document-1' },
      );
    });

    expect(harness.tabs.sendMessage).toHaveBeenNthCalledWith(
      1,
      7,
      { type: 'PREPARE_SNIP_CAPTURE' },
      { documentId: 'document-1' },
    );
    expect(harness.tabs.captureVisibleTab).toHaveBeenCalledWith(2, { format: 'png' });
    const prepareOrder = harness.tabs.sendMessage.mock.invocationCallOrder[0];
    const captureOrder = harness.tabs.captureVisibleTab.mock.invocationCallOrder[0];
    const startOrder = harness.tabs.sendMessage.mock.invocationCallOrder[1];
    expect(prepareOrder).toBeLessThan(captureOrder);
    expect(captureOrder).toBeLessThan(startOrder);
    expect(harness.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['content-script.js'],
    });
    expect(harness.scripting.insertCSS).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.tabs.sendMessage.mock.calls)).not.toContain(
      'sk-ant-test-secret',
    );

    const startMessage = harness.tabs.sendMessage.mock.calls
      .map(([, message]) => message as { type?: string; captureId?: string })
      .find((message) => message.type === 'START_SNIP');
    const captureId = startMessage?.captureId;
    expect(captureId).toBeTypeOf('string');
    await expect(dispatch(harness, {
      ...captureRequest(captureId!),
      dataUrl: 'data:image/png;base64,CONTENT_FALLBACK',
    })).resolves.toEqual({ ok: true });
    expect(dependencies.cropImage).toHaveBeenLastCalledWith(
      'data:image/png;base64,FULL',
      { x: 10, y: 20, width: 100, height: 50 },
      2,
    );
  });

  it('starts snipping from one cold shortcut invocation', async () => {
    const harness = await loadWorker();

    harness.command.emit('snip', trustedSender().tab!);

    await vi.waitFor(() => {
      expect(harness.tabs.sendMessage).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: 'START_SNIP' }),
        { documentId: 'document-1' },
      );
    });
    expect(harness.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('uses the active session settings when requesting a new snip', async () => {
    const harness = await loadWorker();
    const sessionSettings = {
      defaultPrompt: 'Keep this session prompt.',
      limits: { ...testLimits, maxConversationTurns: 4 },
    };

    await expect(dispatch(harness, {
      type: 'REQUEST_SNIP',
      sessionSettings,
    })).resolves.toEqual({ ok: true });

    expect(harness.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'START_SNIP',
        dataUrl: 'data:image/png;base64,FULL',
        defaultPrompt: sessionSettings.defaultPrompt,
        limits: sessionSettings.limits,
      }),
      { documentId: 'document-1' },
    );
  });

  it('waits for slow content initialization before sending START_SNIP', async () => {
    const harness = await loadWorker();
    const initialization = deferred<chrome.scripting.InjectionResult<unknown>[]>();
    harness.scripting.executeScript.mockReturnValueOnce(initialization.promise);

    harness.command.emit('snip', trustedSender().tab!);
    await vi.waitFor(() => {
      expect(harness.scripting.executeScript).toHaveBeenCalledTimes(1);
    });
    expect(harness.tabs.sendMessage).not.toHaveBeenCalled();

    initialization.resolve([{
      documentId: 'document-1',
      frameId: 0,
      result: undefined,
    }]);

    await vi.waitFor(() => {
      expect(harness.tabs.sendMessage).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: 'START_SNIP' }),
        { documentId: 'document-1' },
      );
    });
    expect(harness.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('activates an already-loaded content script exactly once per invocation', async () => {
    const harness = await loadWorker();
    const tab = trustedSender().tab!;

    harness.actionClicked.emit(tab);
    await vi.waitFor(() => {
      expect(harness.tabs.sendMessage).toHaveBeenCalledTimes(2);
    });

    harness.actionClicked.emit(tab);
    await vi.waitFor(() => {
      expect(harness.tabs.sendMessage).toHaveBeenCalledTimes(4);
    });

    expect(harness.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(harness.tabs.sendMessage.mock.calls.filter(([, message]) => (
      message as { type?: string }
    ).type === 'START_SNIP')).toHaveLength(2);
  });

  it('bounds stalled initialization and shows visible browser feedback', async () => {
    vi.useFakeTimers();
    const harness = await loadWorker();
    harness.scripting.executeScript.mockReturnValueOnce(new Promise(() => undefined));
    harness.tabs.sendMessage.mockRejectedValue(new Error('No receiver'));

    harness.actionClicked.emit(trustedSender().tab!);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.scripting.executeScript).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(harness.tabs.sendMessage).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'START_SNIP' }),
      expect.anything(),
    );
    expect(harness.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 7,
      text: '!',
    });
    expect(harness.action.setTitle).toHaveBeenCalledWith({
      tabId: 7,
      title: "SnapScreen couldn't start on this page. Reload it and try again.",
    });
  });

  it('does not activate a replacement document after navigation during initialization', async () => {
    const harness = await loadWorker();
    const initialization = deferred<chrome.scripting.InjectionResult<unknown>[]>();
    harness.scripting.executeScript.mockReturnValueOnce(initialization.promise);
    const tab = trustedSender().tab!;

    harness.actionClicked.emit(tab);
    await vi.waitFor(() => {
      expect(harness.scripting.executeScript).toHaveBeenCalledTimes(1);
    });
    harness.updated.emit(7, { status: 'loading' }, {
      ...tab,
      url: 'https://example.test/replacement',
    });
    initialization.resolve([{
      documentId: 'document-2',
      frameId: 0,
      result: undefined,
    }]);

    await vi.waitFor(() => {
      expect(harness.action.setTitle).toHaveBeenCalledWith({
        tabId: 7,
        title: 'SnapScreen did not start because the page changed. Try again on the current page.',
      });
    });
    expect(harness.tabs.sendMessage).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'START_SNIP' }),
      expect.anything(),
    );
  });

  it('uses a badge rather than light-DOM injection when no content UI can receive an error', async () => {
    const harness = await loadWorker();
    harness.tabs.sendMessage.mockRejectedValueOnce(new Error('No receiver'));
    const restrictedTab = {
      ...trustedSender().tab!,
      url: 'chrome://settings',
    };

    harness.actionClicked.emit(restrictedTab);
    await vi.waitFor(() => {
      expect(harness.action.setBadgeText).toHaveBeenCalledWith({
        tabId: 7,
        text: '!',
      });
    });

    expect(harness.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('surfaces isolated-frame startup failures in browser chrome', async () => {
    const harness = await loadWorker();

    await expect(dispatch(harness, { type: 'UI_UNAVAILABLE' })).resolves.toEqual({
      ok: true,
    });

    expect(harness.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 7,
      text: '!',
    });
    expect(harness.action.setTitle).toHaveBeenCalledWith({
      tabId: 7,
      title: 'SnapScreen could not open its isolated UI on this page. Please try again.',
    });
    expect(harness.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('recognizes the current Chrome Web Store as a restricted page', async () => {
    const harness = await loadWorker();
    harness.tabs.sendMessage.mockRejectedValueOnce(new Error('No receiver'));

    harness.actionClicked.emit({
      ...trustedSender().tab!,
      url: 'https://chromewebstore.google.com/detail/example/abcdefghijklmnop',
    });
    await vi.waitFor(() => {
      expect(harness.action.setTitle).toHaveBeenCalledWith({
        tabId: 7,
        title: 'Cannot capture this page. SnapScreen supports regular HTTP and HTTPS pages only.',
      });
    });

    expect(harness.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('rejects file pages before injecting an unusable UI session', async () => {
    const harness = await loadWorker();
    harness.tabs.sendMessage.mockRejectedValueOnce(new Error('No receiver'));

    harness.actionClicked.emit({
      ...trustedSender().tab!,
      url: 'file:///tmp/question.html',
    });
    await vi.waitFor(() => {
      expect(harness.action.setTitle).toHaveBeenCalledWith({
        tabId: 7,
        title: 'Cannot capture this page. SnapScreen supports regular HTTP and HTTPS pages only.',
      });
    });

    expect(harness.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does not let an older badge timer clear a newer error', async () => {
    vi.useFakeTimers();
    const harness = await loadWorker();
    harness.tabs.sendMessage.mockRejectedValue(new Error('No receiver'));
    const restrictedTab = {
      ...trustedSender().tab!,
      url: 'chrome://settings',
    };

    harness.actionClicked.emit(restrictedTab);
    await vi.waitFor(() => expect(harness.action.setBadgeText).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(4_000);
    harness.actionClicked.emit(restrictedTab);
    await vi.waitFor(() => expect(harness.action.setBadgeText).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(harness.action.setBadgeText).not.toHaveBeenCalledWith({
      tabId: 7,
      text: '',
    });

    await vi.advanceTimersByTimeAsync(4_000);
    expect(harness.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 7,
      text: '',
    });
  });

  it('does not let a slower older badge update postpone newer cleanup', async () => {
    vi.useFakeTimers();
    const olderTitle = deferred<void>();
    const harness = await loadWorker();
    harness.action.setTitle
      .mockReturnValueOnce(olderTitle.promise)
      .mockResolvedValueOnce(undefined);

    const older = dispatch(harness, { type: 'UI_UNAVAILABLE' });
    const olderResponse = expect(older).resolves.toEqual({ ok: true });
    await Promise.resolve();
    const newer = dispatch(harness, { type: 'UI_UNAVAILABLE' });
    await expect(newer).resolves.toEqual({ ok: true });

    await vi.advanceTimersByTimeAsync(1_500);
    olderTitle.resolve();
    await olderResponse;
    await vi.advanceTimersByTimeAsync(3_500);

    expect(harness.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 7,
      text: '',
    });
  });

  it('clears active badge feedback when the tab navigates', async () => {
    const harness = await loadWorker();

    await expect(dispatch(harness, { type: 'UI_UNAVAILABLE' })).resolves.toEqual({
      ok: true,
    });
    harness.updated.emit(7, { status: 'loading' }, trustedSender().tab!);

    await vi.waitFor(() => {
      expect(harness.action.setBadgeText).toHaveBeenCalledWith({
        tabId: 7,
        text: '',
      });
      expect(harness.action.setTitle).toHaveBeenCalledWith({
        tabId: 7,
        title: 'SnapScreen – Snip and analyze',
      });
    });
  });

  it('clears partial badge feedback when one action API call fails', async () => {
    vi.useFakeTimers();
    const harness = await loadWorker();
    harness.action.setTitle.mockRejectedValueOnce(new Error('Title unavailable'));

    const response = dispatch(harness, { type: 'UI_UNAVAILABLE' });
    await vi.runAllTimersAsync();
    await expect(response).resolves.toEqual({ ok: true });

    expect(harness.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 7,
      text: '',
    });
  });

  it('does not relay secrets from unexpected generation errors', async () => {
    const harness = await loadWorker();
    dependencies.analyzeImage.mockRejectedValueOnce(
      new Error('request failed with sk-ant-should-not-leak'),
    );

    const response = await dispatch(
      harness,
      analyzeRequest('capture-1', 'request-secret-error'),
    );

    expect(response).toEqual({
      error: 'SnapScreen could not complete this request. Please try again.',
    });
    expect(JSON.stringify(harness.tabs.sendMessage.mock.calls)).not.toContain(
      'sk-ant-should-not-leak',
    );
  });
});
