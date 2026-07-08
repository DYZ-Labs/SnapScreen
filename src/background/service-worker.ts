import contentScript from '../content/index.ts?script';
import contentCss from '../content/overlay.css?inline';
import { cropImage } from '../lib/crop';
import { analyzeImage, followUp, AnthropicError } from '../lib/anthropic';
import { getSettings } from '../lib/storage';
import type { CsToBgMessage } from '../lib/messages';

const RESTRICTED_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'https://chrome.google.com/webstore',
];

const abortByTab = new Map<number, AbortController>();

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function startGeneration(tabId: number): AbortController {
  abortByTab.get(tabId)?.abort();
  const controller = new AbortController();
  abortByTab.set(tabId, controller);
  return controller;
}

function finishGeneration(tabId: number, controller: AbortController): void {
  if (abortByTab.get(tabId) === controller) {
    abortByTab.delete(tabId);
  }
}

function isRestrictedUrl(url?: string): boolean {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function showPageToast(tabId: number, message: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_ERROR', message });
    return;
  } catch {
    // Content script not loaded yet — inject a minimal toast.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg: string) => {
        const id = 'snapscreen-toast-root';
        document.getElementById(id)?.remove();
        const toast = document.createElement('div');
        toast.id = id;
        toast.textContent = msg;
        Object.assign(toast.style, {
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: '2147483647',
          padding: '10px 18px',
          borderRadius: '8px',
          background: 'rgba(0,0,0,0.85)',
          color: '#fff',
          font: '13px/1.4 system-ui, -apple-system, sans-serif',
          maxWidth: 'min(400px, calc(100vw - 32px))',
          textAlign: 'center',
        });
        document.documentElement.append(toast);
        setTimeout(() => toast.remove(), 5000);
      },
      args: [message],
    });
  } catch {
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setTitle({ tabId, title: message });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' });
      chrome.action.setTitle({ tabId, title: 'SnapScreen – Snip and analyze' });
    }, 5000);
  }
}

async function startSnip(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [contentScript],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      css: contentCss,
    });
    await chrome.tabs.sendMessage(tabId, { type: 'START_SNIP' });
  } catch {
    await showPageToast(
      tabId,
      "SnapScreen couldn't start — try clicking the toolbar icon instead",
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
      'Cannot capture this page (chrome:// and extension pages are blocked)',
    );
    return;
  }

  await startSnip(resolved.id);
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

chrome.runtime.onMessage.addListener((message: CsToBgMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  const tabId = sender.tab?.id;

  void (async () => {
    try {
      switch (message.type) {
        case 'CAPTURE_REGION': {
          if (!tabId || sender.tab?.windowId === undefined) {
            sendResponse({ error: 'No tab context' });
            return;
          }
          const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
            format: 'png',
          });
          const cropped = await cropImage(dataUrl, message.rect, message.devicePixelRatio);
          await chrome.tabs.sendMessage(tabId, {
            type: 'CROPPED_IMAGE',
            dataUrl: cropped,
          });
          sendResponse({ ok: true });
          break;
        }

        case 'ANALYZE': {
          if (!tabId) {
            sendResponse({ error: 'No tab context' });
            return;
          }

          const controller = startGeneration(tabId);
          const { screenshotId } = message;

          try {
            const settings = await getSettings();
            if (!settings.apiKey) {
              await chrome.tabs.sendMessage(tabId, {
                type: 'ANALYZE_ERROR',
                code: 'no_api_key',
                message: 'No API key configured. Open Settings to add your Anthropic API key.',
                screenshotId,
              });
              sendResponse({ ok: false });
              return;
            }

            const prompt = message.prompt ?? settings.defaultPrompt;
            const result = await analyzeImage(
              settings.apiKey,
              message.dataUrl,
              prompt,
              controller.signal,
            );

            if (controller.signal.aborted) {
              sendResponse({ ok: false, aborted: true });
              return;
            }

            await chrome.tabs.sendMessage(tabId, {
              type: 'ANALYZE_RESULT',
              text: result.text,
              history: result.history,
              prompt,
              screenshotId,
            });
            sendResponse({ ok: true });
          } finally {
            finishGeneration(tabId, controller);
          }
          break;
        }

        case 'FOLLOW_UP': {
          if (!tabId) {
            sendResponse({ error: 'No tab context' });
            return;
          }

          const controller = startGeneration(tabId);
          const { screenshotId } = message;

          try {
            const settings = await getSettings();
            if (!settings.apiKey) {
              await chrome.tabs.sendMessage(tabId, {
                type: 'ANALYZE_ERROR',
                code: 'no_api_key',
                message: 'No API key configured. Open Settings to add your Anthropic API key.',
                screenshotId,
              });
              sendResponse({ ok: false });
              return;
            }

            const result = await followUp(
              settings.apiKey,
              message.text,
              message.history,
              controller.signal,
            );

            if (controller.signal.aborted) {
              sendResponse({ ok: false, aborted: true });
              return;
            }

            await chrome.tabs.sendMessage(tabId, {
              type: 'ANALYZE_RESULT',
              text: result.text,
              history: result.history,
              screenshotId,
            });
            sendResponse({ ok: true });
          } finally {
            finishGeneration(tabId, controller);
          }
          break;
        }

        case 'CANCEL_GENERATION': {
          if (tabId) {
            abortByTab.get(tabId)?.abort();
            abortByTab.delete(tabId);
          }
          sendResponse({ ok: true });
          break;
        }

        case 'SNIP_CANCELLED':
          sendResponse({ ok: true });
          break;
      }
    } catch (err) {
      if (isAbortError(err)) {
        sendResponse({ ok: false, aborted: true });
        return;
      }

      const code = err instanceof AnthropicError ? err.code : 'unknown';
      const errorMessage =
        err instanceof Error ? err.message : 'An unexpected error occurred.';

      if (
        tabId &&
        (message.type === 'ANALYZE' || message.type === 'FOLLOW_UP')
      ) {
        await chrome.tabs.sendMessage(tabId, {
          type: 'ANALYZE_ERROR',
          code,
          message: errorMessage,
          screenshotId: message.screenshotId,
        });
      }
      sendResponse({ error: errorMessage });
    }
  })();

  return true;
});
