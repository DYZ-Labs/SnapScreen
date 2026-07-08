import { startSnipOverlay } from './snip-overlay';
import { showResultPanel, showErrorToast, updateStreamingAnswer } from './result-panel';
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
let lastHint: string | undefined;
let retryLastRequest: (() => void) | null = null;
let awaitingResponse = false;

function resetSessionState(): void {
  isPanelOpen = false;
  screenshotId = null;
  displayMessages = [];
  conversationHistory = [];
  currentDataUrl = '';
  lastRect = undefined;
  retryLastRequest = null;
  awaitingResponse = false;
}

function cleanup(): void {
  chrome.runtime.sendMessage({ type: 'CANCEL_GENERATION' });
  resetSessionState();
}

function isActiveSession(messageScreenshotId: string): boolean {
  return isPanelOpen && screenshotId !== null && messageScreenshotId === screenshotId;
}

function renderPanel(state: { pending: boolean; error?: string; errorCode?: string }): void {
  isPanelOpen = true;
  showResultPanel({
    dataUrl: currentDataUrl || undefined,
    messages: displayMessages,
    error: state.error,
    errorCode: state.errorCode,
    pending: state.pending,
    anchorRect: lastRect,
    onClose: cleanup,
    onFollowUp: handleFollowUp,
    onStop: stopGeneration,
    onRetry: retryLastRequest ?? undefined,
    onResnip: handleResnip,
  });
}

function stopGeneration(): void {
  awaitingResponse = false;
  chrome.runtime.sendMessage({ type: 'CANCEL_GENERATION' });
  renderPanel({ pending: false });
}

function handleResnip(): void {
  // The panel has already been closed (and cleanup run) by the time this fires.
  beginSnip(lastHint);
}

function sendAnalyze(prompt?: string): void {
  const id = screenshotId;
  if (!id) return;

  retryLastRequest = () => {
    renderPanel({ pending: true });
    sendAnalyze(prompt);
  };
  awaitingResponse = true;
  chrome.runtime.sendMessage({
    type: 'ANALYZE',
    dataUrl: currentDataUrl,
    screenshotId: id,
    prompt,
  });
}

function handleFollowUp(text: string): void {
  const id = screenshotId;
  if (!id) return;

  displayMessages = [...displayMessages, { role: 'user', content: text }];
  renderPanel({ pending: true });

  // If the first analysis never completed (e.g. it was stopped), there is no
  // conversation history containing the screenshot yet — analyze it with the
  // user's question as the prompt instead of sending an imageless follow-up.
  if (conversationHistory.length === 0) {
    sendAnalyze(text);
    return;
  }

  const history = conversationHistory;
  const sendFollowUp = () => {
    awaitingResponse = true;
    chrome.runtime.sendMessage({ type: 'FOLLOW_UP', text, history, screenshotId: id });
  };
  retryLastRequest = () => {
    renderPanel({ pending: true });
    sendFollowUp();
  };
  sendFollowUp();
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
        lastHint = message.hasApiKey
          ? 'Drag to select a region · Click to cancel'
          : 'Drag to select · Set API key in extension settings to analyze · Click to cancel';
        beginSnip(lastHint);
        break;

      case 'CROPPED_IMAGE':
        screenshotId = crypto.randomUUID();
        displayMessages = [];
        conversationHistory = [];
        currentDataUrl = message.dataUrl;
        renderPanel({ pending: true });
        sendAnalyze();
        break;

      case 'ANALYZE_CHUNK':
        if (!isActiveSession(message.screenshotId) || !awaitingResponse) return;
        updateStreamingAnswer(message.text);
        break;

      case 'ANALYZE_RESULT': {
        if (!isActiveSession(message.screenshotId)) return;

        awaitingResponse = false;
        conversationHistory = message.history ?? conversationHistory;
        if (displayMessages.length === 0 && message.prompt) {
          displayMessages = [...displayMessages, { role: 'user', content: message.prompt }];
        }
        displayMessages = [...displayMessages, { role: 'assistant', content: message.text }];
        renderPanel({ pending: false });
        break;
      }

      case 'ANALYZE_ERROR':
        if (!isActiveSession(message.screenshotId)) return;
        awaitingResponse = false;
        renderPanel({ pending: false, error: message.message, errorCode: message.code });
        break;

      case 'SHOW_ERROR':
        showErrorToast(message.message);
        break;
    }
  });
}
