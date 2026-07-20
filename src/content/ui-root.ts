import uiCss from './overlay.css?inline';

const HOST_ID = 'snapscreen-ui-host';
const STYLE_MARKER = 'data-snapscreen-styles';
const OWNERSHIP_MARKER = 'data-snapscreen-owned';

let hostElement: HTMLDivElement | null = null;
let uiRoot: ShadowRoot | null = null;
let documentUiRoot: HTMLElement | null = null;
let returnFocusElement: HTMLElement | null = null;

function restorePageFocus(): void {
  const target = returnFocusElement;
  returnFocusElement = null;
  if (!target?.isConnected) return;
  try {
    target.focus({ preventScroll: true });
  } catch {
    // The page may have made the previous focus target inert or unfocusable.
  }
}

function createUiRoot(): ShadowRoot {
  const existingHost = document.getElementById(HOST_ID);
  if (existingHost?.hasAttribute(OWNERSHIP_MARKER)) existingHost.remove();

  const activeElement = document.activeElement;
  returnFocusElement = activeElement instanceof HTMLElement
    ? activeElement
    : null;

  const host = document.createElement('div');
  host.id = existingHost && !existingHost.hasAttribute(OWNERSHIP_MARKER)
    ? `${HOST_ID}-${crypto.randomUUID()}`
    : HOST_ID;
  host.setAttribute(OWNERSHIP_MARKER, '');
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('inset', '0', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');
  host.style.setProperty('width', 'auto', 'important');
  host.style.setProperty('height', 'auto', 'important');

  const root = host.attachShadow({ mode: 'closed' });
  try {
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(uiCss);
    root.adoptedStyleSheets = [stylesheet];
  } catch {
    // Test DOMs and older embedded engines may not implement constructed sheets.
    const style = document.createElement('style');
    style.setAttribute(STYLE_MARKER, '');
    style.textContent = uiCss;
    root.append(style);
  }
  document.documentElement.append(host);

  hostElement = host;
  uiRoot = root;
  return root;
}

export function getUiRoot(): ShadowRoot | HTMLElement {
  if (documentUiRoot?.isConnected) return documentUiRoot;
  if (!hostElement?.isConnected || !uiRoot) {
    hostElement = null;
    uiRoot = null;
    return createUiRoot();
  }
  return uiRoot;
}

export function queryUiElement<T extends Element = HTMLElement>(
  selector: string,
): T | null {
  if (documentUiRoot?.isConnected) {
    return documentUiRoot.querySelector<T>(selector);
  }
  if (!hostElement?.isConnected || !uiRoot) return null;
  return uiRoot.querySelector<T>(selector);
}

export function removeUiHostIfEmpty(): void {
  // An empty extension-frame body is intentional while the background crops
  // the selected region and before the result panel is rendered.
  if (documentUiRoot?.isConnected) return;
  if (!hostElement?.isConnected || !uiRoot) {
    hostElement = null;
    uiRoot = null;
    return;
  }

  const hasUi = Array.from(uiRoot.children).some(
    (element) => !element.hasAttribute(STYLE_MARKER),
  );
  if (hasUi) return;

  hostElement.remove();
  hostElement = null;
  uiRoot = null;
  restorePageFocus();
}

/** Routes the existing UI renderers into the extension-origin frame. */
export function setDocumentUiRoot(root: HTMLElement): void {
  hostElement?.remove();
  hostElement = null;
  uiRoot = null;
  documentUiRoot = root;
}

/** Internal test seam; the returned root remains closed to the host page. */
export function getUiRootForTesting(): ShadowRoot | null {
  return uiRoot;
}

export function getUiHostForTesting(): HTMLDivElement | null {
  return hostElement;
}

export function disposeUiRootForTesting(): void {
  hostElement?.remove();
  hostElement = null;
  uiRoot = null;
  documentUiRoot = null;
  restorePageFocus();
}
