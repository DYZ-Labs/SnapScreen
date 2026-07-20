# SnapScreen

A Chrome extension that turns any on-screen question into an instant answer using Anthropic Claude.

## Features

- **Snip mode** — click the toolbar icon or press `Alt+Shift+S` (`Option+Shift+S` on macOS)
- **Region selection** — drag a rectangle, or create and adjust one entirely from the keyboard
- **AI analysis** — sends the capture to Claude's vision API with your question
- **Follow-up questions** — ask more about the same screenshot without re-capturing
- **Streaming answers** — responses appear word by word as they're generated
- **Session controls** — stop, retry, copy an answer, enlarge the capture, or start a new snip
- **Request safeguards** — configurable question, image-size, image-dimension, and conversation limits
- **Dark & light mode** — the answer panel and settings page adapt to your system theme

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
3. Drag to select a region, or press **Enter** to create a keyboard selection
4. Wait for the AI answer to appear in the overlay panel
5. Type a follow-up question if needed

For keyboard selection, use the **arrow keys** to move the rectangle, **Shift + arrow keys** to resize it, and **Enter** to confirm. Press **Esc** or click without dragging during selection to cancel. Click outside the result panel to dismiss it.

## Development

```bash
npm run dev
```

Load the `dist/` folder as an unpacked extension. Vite will rebuild on file changes — reload the extension in `chrome://extensions` after changes.

Before submitting a change, run the automated checks:

```bash
npm run typecheck
npm test
npm run build
npm run test:browser
```

The browser smoke test launches Playwright's bundled Chromium with an isolated profile, loads `dist/` as an unpacked extension, then uses the extension service worker to inject the built content-script bundle and start the selection UI on a strict-CSP fixture page. It drives keyboard crop selection, injects a deterministic cropped image for that capture, mocks a streamed Anthropic answer, and exercises the result composer inside the extension-origin UI frame. A hostile-page probe verifies that answer/composer text and keyboard/input events never reach the host DOM or its capture listeners. The test does not exercise toolbar activation, Chrome's `activeTab` grant behavior, or the browser's real screenshot encoder. Install its browser once with `npx playwright install chromium`; the extension build must exist before running the smoke test.

## Limitations

- Captures only the **visible viewport** of the current tab (no full-page stitching)
- Runs on regular HTTP(S) pages only; browser-internal, Web Store, file, and other special pages are not supported
- Requires an internet connection and a valid Anthropic API key for AI analysis
- Requires Chrome 116 or newer

## Privacy

Your API key is stored unencrypted in `chrome.storage.local` on your device and is sent directly to Anthropic's API only from trusted extension contexts: the background service for screenshot analysis, and the options page when you choose **Test key**. It never passes through a third-party server. SnapScreen restricts local extension storage to trusted extension contexts, and its content scripts (the code injected into web pages) neither read nor receive the key.

This is defense in depth, not credential encryption: anyone who can access or copy your Chrome profile may still be able to extract the key. Use a dedicated Anthropic key with an appropriate spend limit, revoke it if the profile is lost or compromised, and remove it from SnapScreen when it is no longer needed. Screenshots are sent directly to Anthropic for analysis and are not persisted by SnapScreen.

### Injected UI isolation

SnapScreen renders every injected interactive surface—the crop selector, result panel, screenshot lightbox, composer, and toast—inside a full-viewport extension-origin iframe. The iframe is mounted inside a closed-shadow outer `#snapscreen-ui-host`, so page CSS cannot restyle the UI and ordinary page DOM APIs cannot locate the iframe or query its screenshot, answer, composer value, lightbox, or controls. The host is removed when the UI is dismissed so it does not affect page layout or captured pixels. The extension frame also remains loadable on pages with a strict host Content Security Policy.

The isolated content script keeps capture and conversation state. It creates a fresh 32-byte capability for each UI session, registers it with the background for its tab and top-level document, places it in the hidden iframe URL fragment, and transfers one end of a `MessageChannel` directly to that child with an exact extension `targetOrigin`. The exact packaged child frame must claim that capability once before it acknowledges the channel; claims expire and cannot be replayed or moved across tabs. Screenshot data, streamed answers, composer submissions, and actions then travel only over the private port, never through ordinary `window.postMessage`, page DOM events, or DOM attributes. Commands are validated and buffered until attestation completes. Privileged actions such as opening Settings are sent back to the trusted content controller rather than executed by the web-accessible frame, and normal background commands reject extension-frame senders.

This boundary protects confidentiality and prevents page capture listeners from cancelling the frame's keyboard/input handling, but it is not a tamper-proof browser surface. Chrome exposes coarse pointer activity retargeted to the outer host (not the internal target or text); tests confirm that parent `preventDefault()` and `stopImmediatePropagation()` do not block the child click. A hostile page can still remove, move, cover, or navigate the outer host and cause denial of service or attempt clickjacking. The packaged frame is web-accessible, but a page-created copy remains inert because it cannot register or claim a legitimate session capability. A page can still imitate the extension visually with its own HTML, so treat unexpected or context-sensitive prompts as untrusted, just as with any UI rendered inside a web page.
# SnapScreen
# SnapScreen
