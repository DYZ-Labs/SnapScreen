import { DEFAULT_PROMPT, getSettings, saveSettings } from '../lib/storage';

const form = document.getElementById('settings-form') as HTMLFormElement;
const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const promptInput = document.getElementById('default-prompt') as HTMLTextAreaElement;
const status = document.getElementById('status') as HTMLSpanElement;

async function load(): Promise<void> {
  const settings = await getSettings();
  apiKeyInput.value = settings.apiKey;
  promptInput.value = settings.defaultPrompt || DEFAULT_PROMPT;
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

function showStatus(message: string, isError = false): void {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('error', isError);

  setTimeout(() => {
    status.hidden = true;
  }, 3000);
}

void load();
