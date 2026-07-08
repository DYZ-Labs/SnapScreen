import { verifyApiKey } from '../lib/anthropic';
import { DEFAULT_PROMPT, getSettings, saveSettings } from '../lib/storage';

const form = document.getElementById('settings-form') as HTMLFormElement;
const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const toggleKeyBtn = document.getElementById('toggle-key') as HTMLButtonElement;
const testKeyBtn = document.getElementById('test-key') as HTMLButtonElement;
const promptInput = document.getElementById('default-prompt') as HTMLTextAreaElement;
const status = document.getElementById('status') as HTMLSpanElement;
const shortcutDisplay = document.getElementById('shortcut-display') as HTMLElement;
const openShortcutsBtn = document.getElementById('open-shortcuts') as HTMLButtonElement;

let statusTimeout: ReturnType<typeof setTimeout> | undefined;

async function load(): Promise<void> {
  const settings = await getSettings();
  apiKeyInput.value = settings.apiKey;
  promptInput.value = settings.defaultPrompt || DEFAULT_PROMPT;
}

async function loadShortcut(): Promise<void> {
  const commands = await chrome.commands.getAll();
  const snip = commands.find((command) => command.name === 'snip');
  shortcutDisplay.textContent = snip?.shortcut || 'no shortcut set';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const apiKey = apiKeyInput.value.trim();
  const defaultPrompt = promptInput.value.trim() || DEFAULT_PROMPT;

  if (!apiKey) {
    showStatus('API key is required.', true);
    return;
  }

  await saveSettings({ apiKey, defaultPrompt });
  showStatus('Settings saved.');
});

toggleKeyBtn.addEventListener('click', () => {
  const show = apiKeyInput.type === 'password';
  apiKeyInput.type = show ? 'text' : 'password';
  toggleKeyBtn.textContent = show ? 'Hide' : 'Show';
  toggleKeyBtn.setAttribute('aria-label', show ? 'Hide API key' : 'Show API key');
  toggleKeyBtn.setAttribute('aria-pressed', String(show));
});

testKeyBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showStatus('Enter an API key to test.', true);
    return;
  }

  testKeyBtn.disabled = true;
  showStatus('Testing…', false, { sticky: true });
  try {
    await verifyApiKey(apiKey);
    showStatus('API key works.');
  } catch (err) {
    showStatus(err instanceof Error ? err.message : 'Test failed.', true);
  } finally {
    testKeyBtn.disabled = false;
  }
});

openShortcutsBtn.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

function showStatus(message: string, isError = false, opts?: { sticky?: boolean }): void {
  clearTimeout(statusTimeout);
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('error', isError);

  if (!opts?.sticky) {
    statusTimeout = setTimeout(() => {
      status.hidden = true;
    }, 3000);
  }
}

void load();
void loadShortcut();
