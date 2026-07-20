import contentScript from '../content/index.ts?script&iife';
import { cropImage } from '../lib/crop';
import { analyzeImage, followUp, AnthropicError } from '../lib/anthropic';
import {
  getSettings,
  initializeStorageAccess,
  normalizeLimits,
  type SnapScreenSessionSettings,
} from '../lib/storage';
import type { BgToCsMessage, CsToBgMessage } from '../lib/messages';
import {
  UI_CLAIM_CAPABILITY,
  UI_FRAME_PATH,
  UI_REGISTER_CAPABILITY,
  UI_REVOKE_CAPABILITY,
  isUiAttestationMessage,
  type UiAttestationMessage,
  type UiAttestationResponse,
} from '../lib/ui-protocol';
import {
  ActiveTabChangedError,
  CaptureSupersededError,
  captureInitiatingTab,
} from './capture-session';
import { GenerationRegistry, type ActiveGeneration } from './generation-registry';
import {
  getDocumentMessageOptions,
  type DocumentTarget,
} from './document-target';
import { UiCapabilityRegistry } from './ui-capability-registry';

const RESTRICTED_PREFIXES = [
  'https://chrome.google.com/webstore',
  'https://chromewebstore.google.com/',
];

const generations = new GenerationRegistry();
const uiCapabilities = new UiCapabilityRegistry();

interface CaptureRecord extends DocumentTarget {
  captureId: string;
}

const captureByDocument = new Map<string, CaptureRecord>();
const activationVersionByWindow = new Map<number, number>();
const badgeClearTimers = new Map<number, ReturnType<typeof setTimeout>>();
const actionFeedbackVersionByTab = new Map<number, number>();
let nextActionFeedbackVersion = 0;

const GENERIC_CAPTURE_ERROR =
  'SnapScreen could not capture that region. Please try again.';
const GENERIC_GENERATION_ERROR =
  'SnapScreen could not complete this request. Please try again.';
const DEFAULT_ACTION_TITLE = 'SnapScreen – Snip and analyze';
const SNIP_START_TIMEOUT_MS = 5_000;
const documentVersionByTab = new Map<number, number>();

void initializeStorageAccess();

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function getPublicCaptureError(err: unknown): { code: string; message: string } {
  if (err instanceof ActiveTabChangedError) {
    return { code: 'active_tab_changed', message: err.message };
  }
  return { code: 'capture', message: GENERIC_CAPTURE_ERROR };
}

function getPublicGenerationError(err: unknown): { code: string; message: string } {
  if (err instanceof AnthropicError) {
    return { code: err.code, message: err.message };
  }
  return { code: 'unknown', message: GENERIC_GENERATION_ERROR };
}

function documentKey(tabId: number, documentId?: string): string {
  return `${tabId}:${documentId ?? 'unknown'}`;
}

function beginCapture(target: DocumentTarget, captureId: string): boolean {
  const key = documentKey(target.tabId, target.documentId);
  if (captureByDocument.get(key)?.captureId === captureId) return false;
  captureByDocument.set(key, { ...target, captureId });
  return true;
}

function isCurrentCapture(target: DocumentTarget, captureId: string): boolean {
  return captureByDocument.get(documentKey(target.tabId, target.documentId))?.captureId === captureId;
}

function clearTabState(tabId: number): void {
  generations.clearTab(tabId);
  uiCapabilities.clearTab(tabId);
  const hadActionFeedback = actionFeedbackVersionByTab.delete(tabId);
  const badgeTimer = badgeClearTimers.get(tabId);
  if (badgeTimer !== undefined) {
    clearTimeout(badgeTimer);
    badgeClearTimers.delete(tabId);
  }
  if (hadActionFeedback || badgeTimer !== undefined) {
    void clearActionFeedback(tabId);
  }
  for (const [key, capture] of captureByDocument) {
    if (capture.tabId === tabId) captureByDocument.delete(key);
  }
}

async function clearActionFeedback(tabId: number): Promise<void> {
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: '' }),
    chrome.action.setTitle({ tabId, title: DEFAULT_ACTION_TITLE }),
  ]);
}

function getSenderUrl(sender: chrome.runtime.MessageSender): URL | null {
  if (!sender.url) return null;
  try {
    return new URL(sender.url);
  } catch {
    return null;
  }
}

function isTrustedTopFrameContentSender(
  sender: chrome.runtime.MessageSender,
): boolean {
  const url = getSenderUrl(sender);
  return sender.id === chrome.runtime.id
    && sender.frameId === 0
    && !!sender.tab
    && typeof sender.tab.id === 'number'
    && !!url
    && (url.protocol === 'http:' || url.protocol === 'https:')
    && sender.origin === url.origin;
}

function isTrustedUiFrameSender(sender: chrome.runtime.MessageSender): boolean {
  const url = getSenderUrl(sender);
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  return sender.id === chrome.runtime.id
    && typeof sender.frameId === 'number'
    && sender.frameId > 0
    && !!sender.tab
    && typeof sender.tab.id === 'number'
    && !!url
    && url.protocol === 'chrome-extension:'
    && url.host === chrome.runtime.id
    && url.pathname === `/${UI_FRAME_PATH}`
    && sender.origin === extensionOrigin;
}

function handleUiAttestation(
  message: UiAttestationMessage,
  sender: chrome.runtime.MessageSender,
): UiAttestationResponse {
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') return { ok: false, error: 'ui_auth_failed' };

  let ok = false;
  switch (message.type) {
    case UI_REGISTER_CAPABILITY:
      if (isTrustedTopFrameContentSender(sender)) {
        ok = uiCapabilities.register(
          { tabId, documentId: sender.documentId },
          message.sessionId,
          message.nonce,
        );
      }
      break;
    case UI_CLAIM_CAPABILITY:
      if (isTrustedUiFrameSender(sender)) {
        ok = uiCapabilities.claim(tabId, message.sessionId, message.nonce);
      }
      break;
    case UI_REVOKE_CAPABILITY:
      if (isTrustedTopFrameContentSender(sender)) {
        ok = uiCapabilities.revoke(
          { tabId, documentId: sender.documentId },
          message.sessionId,
        );
      }
      break;
  }
  return ok ? { ok: true } : { ok: false, error: 'ui_auth_failed' };
}

function getDocumentTarget(
  tabId: number,
  documentId: string | undefined,
): DocumentTarget {
  return { tabId, documentId };
}

function getRequestSessionSettings(
  value: SnapScreenSessionSettings | undefined,
  fallback: SnapScreenSessionSettings,
): SnapScreenSessionSettings {
  return {
    defaultPrompt: value?.defaultPrompt.trim() || fallback.defaultPrompt,
    limits: normalizeLimits(value?.limits ?? fallback.limits),
  };
}

function sendToDocument(
  target: DocumentTarget,
  message: BgToCsMessage,
): Promise<unknown> {
  return chrome.tabs.sendMessage(
    target.tabId,
    message,
    getDocumentMessageOptions(target),
  );
}

async function safeSendToDocument(
  target: DocumentTarget,
  message: BgToCsMessage,
): Promise<boolean> {
  try {
    await sendToDocument(target, message);
    return true;
  } catch {
    return false;
  }
}

function makeDeltaRelay(
  target: DocumentTarget,
  ids: { captureId: string; requestId: string; screenshotId: string },
  generation: ActiveGeneration,
): (textSoFar: string) => void {
  return (textSoFar) => {
    if (!generations.isCurrent(target.tabId, ids.requestId)) return;
    sendToDocument(target, { type: 'ANALYZE_CHUNK', text: textSoFar, ...ids })
      .catch(() => {
        // If the original document is gone, stop spending tokens immediately.
        generations.cancel(target.tabId, generation.requestId);
      });
  };
}

function isRestrictedUrl(url?: string): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  } catch {
    return true;
  }
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function showActionBadge(tabId: number, message: string): Promise<void> {
  const feedbackVersion = ++nextActionFeedbackVersion;
  actionFeedbackVersionByTab.set(tabId, feedbackVersion);
  const previousTimer = badgeClearTimers.get(tabId);
  if (previousTimer !== undefined) {
    clearTimeout(previousTimer);
    badgeClearTimers.delete(tabId);
  }

  const results = await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: '!' }),
    chrome.action.setTitle({ tabId, title: message }),
  ]);
  if (actionFeedbackVersionByTab.get(tabId) !== feedbackVersion) return;
  if (results.every((result) => result.status === 'rejected')) {
    actionFeedbackVersionByTab.delete(tabId);
    return;
  }

  const timer = setTimeout(() => {
    if (
      badgeClearTimers.get(tabId) !== timer
      || actionFeedbackVersionByTab.get(tabId) !== feedbackVersion
    ) return;
    badgeClearTimers.delete(tabId);
    actionFeedbackVersionByTab.delete(tabId);
    void clearActionFeedback(tabId);
  }, 5000);
  badgeClearTimers.set(tabId, timer);
}

async function showPageToast(tabId: number, message: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_ERROR', message });
  } catch {
    // If the isolated UI is unavailable, keep feedback in browser chrome.
    await showActionBadge(tabId, message);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`SnapScreen content initialization exceeded ${timeoutMs} ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function startSnip(tabId: number, expectedDocumentVersion: number): Promise<void> {
  try {
    const settings = await getSettings();
    const injectionResults = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId },
        files: [contentScript],
      }),
      SNIP_START_TIMEOUT_MS,
    );

    if ((documentVersionByTab.get(tabId) ?? 0) !== expectedDocumentVersion) {
      await showActionBadge(
        tabId,
        'SnapScreen did not start because the page changed. Try again on the current page.',
      );
      return;
    }

    const topFrameResult = injectionResults.find((result) => result.frameId === 0);
    if (!topFrameResult?.documentId) {
      throw new Error('SnapScreen could not identify the injected page document.');
    }

    await sendToDocument(
      { tabId, documentId: topFrameResult.documentId },
      {
        type: 'START_SNIP',
        hasApiKey: Boolean(settings.apiKey),
        defaultPrompt: settings.defaultPrompt,
        limits: settings.limits,
      },
    );
  } catch {
    if ((documentVersionByTab.get(tabId) ?? 0) !== expectedDocumentVersion) {
      await showActionBadge(
        tabId,
        'SnapScreen did not start because the page changed. Try again on the current page.',
      );
      return;
    }
    await showPageToast(
      tabId,
      "SnapScreen couldn't start on this page. Reload it and try again.",
    );
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function handleStartSnip(tab?: chrome.tabs.Tab): Promise<void> {
  const resolved = tab ?? (await getActiveTab());
  if (!resolved?.id) return;

  if (isRestrictedUrl(resolved.url)) {
    await showPageToast(
      resolved.id,
      'Cannot capture this page. SnapScreen supports regular HTTP and HTTPS pages only.',
    );
    return;
  }

  await startSnip(resolved.id, documentVersionByTab.get(resolved.id) ?? 0);
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener((tab) => {
  void handleStartSnip(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'snip') {
    void handleStartSnip(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  documentVersionByTab.delete(tabId);
  clearTabState(tabId);
});

chrome.tabs.onActivated.addListener(({ windowId }) => {
  activationVersionByWindow.set(
    windowId,
    (activationVersionByWindow.get(windowId) ?? 0) + 1,
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // A URL-only update can be a same-document hash/history change. The content
  // script and its document-scoped session remain valid in that case.
  if (changeInfo.status === 'loading') {
    documentVersionByTab.set(tabId, (documentVersionByTab.get(tabId) ?? 0) + 1);
    clearTabState(tabId);
  }
});

chrome.runtime.onMessage.addListener((
  message: CsToBgMessage | UiAttestationMessage,
  sender,
  sendResponse,
) => {
  if (isUiAttestationMessage(message)) {
    sendResponse(handleUiAttestation(message, sender));
    return;
  }

  const senderTab = sender.tab;
  if (
    !isTrustedTopFrameContentSender(sender)
    || !senderTab
    || typeof senderTab.id !== 'number'
  ) return;

  const tabId = senderTab.id;

  void (async () => {
    try {
      switch (message.type) {
        case 'CAPTURE_REGION': {
          if (senderTab.windowId === undefined) {
            sendResponse({ error: 'No tab context' });
            return;
          }

          const target = getDocumentTarget(tabId, sender.documentId);
          if (!beginCapture(target, message.captureId)) {
            sendResponse({ ok: false, duplicate: true });
            return;
          }

          try {
            const cropped = await captureInitiatingTab(
              {
                getActiveTab: async (windowId) => {
                  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
                  return activeTab ?? null;
                },
                getActivationVersion: (windowId) =>
                  activationVersionByWindow.get(windowId) ?? 0,
                captureVisibleTab: (windowId) =>
                  chrome.tabs.captureVisibleTab(windowId, { format: 'png' }),
                cropImage,
              },
              {
                tabId,
                windowId: senderTab.windowId,
                rect: message.rect,
                devicePixelRatio: message.devicePixelRatio,
                isCurrent: () => isCurrentCapture(target, message.captureId),
              },
            );

            if (!isCurrentCapture(target, message.captureId)) {
              sendResponse({ ok: false, stale: true });
              return;
            }

            await sendToDocument(target, {
              type: 'CROPPED_IMAGE',
              dataUrl: cropped,
              captureId: message.captureId,
            });
            sendResponse({ ok: true });
          } catch (err) {
            if (err instanceof CaptureSupersededError) {
              sendResponse({ ok: false, stale: true });
              return;
            }

            const failure = getPublicCaptureError(err);
            await safeSendToDocument(target, {
              type: 'CAPTURE_ERROR',
              code: failure.code,
              message: failure.message,
              captureId: message.captureId,
            });
            sendResponse({ error: failure.message });
          }
          break;
        }

        case 'ANALYZE': {
          const target = getDocumentTarget(tabId, sender.documentId);
          const generation = generations.start(
            tabId,
            sender.documentId,
            message.captureId,
            message.requestId,
          );
          if (!generation) {
            sendResponse({ ok: false, duplicate: true });
            return;
          }
          const ids = {
            captureId: message.captureId,
            requestId: message.requestId,
            screenshotId: message.screenshotId,
          };

          try {
            const settings = await getSettings();
            if (!settings.apiKey) {
              await sendToDocument(target, {
                type: 'ANALYZE_ERROR',
                code: 'no_api_key',
                message: 'No API key configured. Open Settings to add your Anthropic API key.',
                ...ids,
              });
              sendResponse({ ok: false });
              return;
            }
            const sessionSettings = getRequestSessionSettings(
              message.sessionSettings,
              settings,
            );

            const result = await analyzeImage(
              settings.apiKey,
              message.dataUrl,
              {
                hiddenInstruction: sessionSettings.defaultPrompt,
                userQuestion: message.question,
                signal: generation.controller.signal,
                onDelta: makeDeltaRelay(target, ids, generation),
                limits: sessionSettings.limits,
              },
            );

            if (!generations.isCurrent(tabId, message.requestId)) {
              sendResponse({ ok: false, aborted: true });
              return;
            }

            await sendToDocument(target, {
              type: 'ANALYZE_RESULT',
              text: result.text,
              history: result.history,
              ...ids,
            });
            sendResponse({ ok: true });
          } finally {
            generations.finish(tabId, message.requestId);
          }
          break;
        }

        case 'FOLLOW_UP': {
          const target = getDocumentTarget(tabId, sender.documentId);
          const generation = generations.start(
            tabId,
            sender.documentId,
            message.captureId,
            message.requestId,
          );
          if (!generation) {
            sendResponse({ ok: false, duplicate: true });
            return;
          }
          const ids = {
            captureId: message.captureId,
            requestId: message.requestId,
            screenshotId: message.screenshotId,
          };

          try {
            const settings = await getSettings();
            if (!settings.apiKey) {
              await sendToDocument(target, {
                type: 'ANALYZE_ERROR',
                code: 'no_api_key',
                message: 'No API key configured. Open Settings to add your Anthropic API key.',
                ...ids,
              });
              sendResponse({ ok: false });
              return;
            }
            const sessionSettings = getRequestSessionSettings(
              message.sessionSettings,
              settings,
            );

            const result = await followUp(
              settings.apiKey,
              message.text,
              message.history,
              {
                signal: generation.controller.signal,
                onDelta: makeDeltaRelay(target, ids, generation),
                sessionInstruction: sessionSettings.defaultPrompt,
                limits: sessionSettings.limits,
              },
            );

            if (!generations.isCurrent(tabId, message.requestId)) {
              sendResponse({ ok: false, aborted: true });
              return;
            }

            await sendToDocument(target, {
              type: 'ANALYZE_RESULT',
              text: result.text,
              history: result.history,
              ...ids,
            });
            sendResponse({ ok: true });
          } finally {
            generations.finish(tabId, message.requestId);
          }
          break;
        }

        case 'CANCEL_GENERATION': {
          generations.cancel(tabId, message.requestId);
          sendResponse({ ok: true });
          break;
        }

        case 'SNIP_CANCELLED': {
          const target = getDocumentTarget(tabId, sender.documentId);
          const key = documentKey(tabId, sender.documentId);
          if (isCurrentCapture(target, message.captureId)) {
            captureByDocument.delete(key);
          }
          generations.cancelCapture(tabId, message.captureId);
          sendResponse({ ok: true });
          break;
        }

        case 'UI_UNAVAILABLE': {
          await showActionBadge(
            tabId,
            'SnapScreen could not open its isolated UI on this page. Please try again.',
          );
          sendResponse({ ok: true });
          break;
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        sendResponse({ ok: false, aborted: true });
        return;
      }

      const failure = getPublicGenerationError(err);

      if (
        (message.type === 'ANALYZE' || message.type === 'FOLLOW_UP')
      ) {
        const target = getDocumentTarget(tabId, sender.documentId);
        await safeSendToDocument(target, {
          type: 'ANALYZE_ERROR',
          code: failure.code,
          message: failure.message,
          captureId: message.captureId,
          requestId: message.requestId,
          screenshotId: message.screenshotId,
        });
      }
      sendResponse({ error: failure.message });
    }
  })();

  return true;
});
