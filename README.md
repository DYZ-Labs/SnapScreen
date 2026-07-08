# SnapScreen

A Chrome extension that turns any on-screen question into an instant answer using Anthropic Claude.

## Features

- **Snip mode** — click the toolbar icon or press `Alt+Shift+S` (`Option+Shift+S` on macOS)
- **Region selection** — drag a rectangle over any visible area
- **AI analysis** — sends the capture to Claude's vision API with your question
- **Follow-up questions** — ask more about the same screenshot without re-capturing
- **Dark UI** — the in-page answer panel uses a dark theme; the settings page adapts to your system theme

## Setup

### 1. Get an API key

Create an API key at the [Anthropic Console](https://console.anthropic.com/).

### 2. Build the extension

```bash
npm install
npm run build
```

### 3. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

The options page opens automatically on first install so you can paste your API key.

### 4. Configure

Right-click the SnapScreen icon → **Options**, or open the extension's options page. Enter your API key and optionally customize the default prompt.

**Note:** An API key is only required for AI analysis after you capture a region. Snip mode works without a key — you'll be prompted to add one when analysis runs.

### 5. Set keyboard shortcut (optional)

Visit `chrome://extensions/shortcuts` to confirm or change the snip shortcut. If the default `Alt+Shift+S` doesn't work, it may be unassigned due to a conflict — assign it manually there.

## Usage

1. Navigate to any normal web page
2. Click the SnapScreen icon or press `Alt+Shift+S` / `Option+Shift+S`
3. Drag to select a region
4. Wait for the AI answer to appear in the overlay panel
5. Type a follow-up question if needed

Press **Esc** or click without dragging during selection to cancel. Click outside the result panel to dismiss it.

## Development

```bash
npm run dev
```

Load the `dist/` folder as an unpacked extension. Vite will rebuild on file changes — reload the extension in `chrome://extensions` after changes.

## Limitations

- Captures only the **visible viewport** of the current tab (no full-page stitching)
- Cannot run on restricted pages (`chrome://`, Web Store, etc.)
- Requires an internet connection and a valid Anthropic API key for AI analysis

## Privacy

Your API key is stored unencrypted in `chrome.storage.local` on your device and is only ever sent directly to Anthropic's API from your browser — it never passes through a third-party server, and the extension's content scripts (the code injected into web pages) never read it. Note that anyone with access to your Chrome profile could extract the key, so consider using a dedicated key with a spend limit. Screenshots are sent directly to Anthropic's API and are not stored by the extension.
