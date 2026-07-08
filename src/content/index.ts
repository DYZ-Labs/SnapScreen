import { startSnipOverlay } from './snip-overlay';
import { showResultPanel, showErrorToast } from './result-panel';
import type { AnthropicMessage, BgToCsMessage, DisplayMessage, Rect } from '../lib/messages';

declare global {
  interface Window {
    __snapscreenListenerReady?: boolean;
  }
}

let screenshotId: string | null = null;
let isPanelOpen = false;
let displayMessages: DisplayMessage[] = [];
let conversationHistory: AnthropicMessage[] = [];
let currentDataUrl = '';
let lastRect: Rect | undefined;

function resetSessionState(): void {
  isPanelOpen = false;
  screenshotId = null;
  displayMessages = [];
  conversationHistory = [];
  currentDataUrl = '';
  lastRect = undefined;
}

function cleanup(): void {
  chrome.runtime.sendMessage({ type: 'CANCEL_GENERATION' });
  resetSessionState();
}

function isActiveSession(messageScreenshotId: string): boolean {
  return isPanelOpen && screenshotId !== null && messageScreenshotId === screenshotId;
}

function handleFollowUp(text: string): void {
  if (!screenshotId) return;

  displayMessages = [...displayMessages, { role: 'user', content: text }];
  isPanelOpen = true;
  showResultPanel({
    dataUrl: currentDataUrl,
    messages: displayMessages,
    pending: true,
    anchorRect: lastRect,
    onClose: cleanup,
    onFollowUp: handleFollowUp,
  });
  chrome.runtime.sendMessage({
    type: 'FOLLOW_UP',
    text,
    history: conversationHistory,
    screenshotId,
  });
}

function beginSnip(hintText?: string): void {
  resetSessionState();
  startSnipOverlay({
    hintText,
    onRegionSelected(rect) {
      lastRect = rect;
      chrome.runtime.sendMessage({
        type: 'CAPTURE_REGION',
        rect,
        devicePixelRatio: window.devicePixelRatio,
      });
    },
    onCancelled() {
      chrome.runtime.sendMessage({ type: 'SNIP_CANCELLED' });
    },
  });
}

if (!window.__snapscreenListenerReady) {
  window.__snapscreenListenerReady = true;

  chrome.runtime.onMessage.addListener((message: BgToCsMessage) => {
    switch (message.type) {
      case 'START_SNIP':
        void chrome.storage.local.get(['apiKey']).then((stored) => {
          const hasKey = Boolean(stored.apiKey);
          const hint = hasKey
            ? 'Drag to select a region · Click to cancel'
            : 'Drag to select · Set API key in extension settings to analyze · Click to cancel';
          beginSnip(hint);
        });
        break;

      case 'CROPPED_IMAGE':
        screenshotId = crypto.randomUUID();
        displayMessages = [];
        conversationHistory = [];
        currentDataUrl = message.dataUrl;
        isPanelOpen = true;
        showResultPanel({
          dataUrl: message.dataUrl,
          messages: [],
          pending: true,
          anchorRect: lastRect,
          onClose: cleanup,
          onFollowUp: handleFollowUp,
        });
        chrome.runtime.sendMessage({
          type: 'ANALYZE',
          dataUrl: message.dataUrl,
          screenshotId,
        });
        break;

      case 'ANALYZE_RESULT': {
        if (!isActiveSession(message.screenshotId)) return;

        conversationHistory = message.history ?? conversationHistory;
        const isFirstExchange = displayMessages.length === 0;
        if (isFirstExchange && message.prompt) {
          displayMessages = [...displayMessages, { role: 'user', content: message.prompt }];
        }
        displayMessages = [...displayMessages, { role: 'assistant', content: message.text }];
        showResultPanel({
          dataUrl: currentDataUrl,
          messages: displayMessages,
          pending: false,
          anchorRect: lastRect,
          onClose: cleanup,
          onFollowUp: handleFollowUp,
        });
        break;
      }

      case 'ANALYZE_ERROR': {
        if (!isActiveSession(message.screenshotId)) return;

        const hasThread = displayMessages.length > 0;
        showResultPanel({
          dataUrl: currentDataUrl || undefined,
          messages: hasThread ? displayMessages : undefined,
          error: message.message,
          errorCode: message.code,
          pending: false,
          anchorRect: lastRect,
          onClose: cleanup,
          onFollowUp: handleFollowUp,
        });
        break;
      }

      case 'SHOW_ERROR':
        showErrorToast(message.message);
        break;
    }
  });
}
