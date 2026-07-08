export const DEFAULT_PROMPT =
  'Answer the question shown in this screenshot.';

export interface SnapScreenSettings {
  apiKey: string;
  defaultPrompt: string;
}

const DEFAULTS: SnapScreenSettings = {
  apiKey: '',
  defaultPrompt: DEFAULT_PROMPT,
};

export async function getSettings(): Promise<SnapScreenSettings> {
  const stored = await chrome.storage.local.get(['apiKey', 'defaultPrompt']);
  return {
    apiKey: (stored.apiKey as string) ?? DEFAULTS.apiKey,
    defaultPrompt: (stored.defaultPrompt as string) ?? DEFAULTS.defaultPrompt,
  };
}

export async function saveSettings(settings: Partial<SnapScreenSettings>): Promise<void> {
  await chrome.storage.local.set(settings);
}
