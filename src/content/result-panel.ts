import { clampToViewport, VIEWPORT_MARGIN } from '../lib/clamp-to-viewport';
import type { DisplayMessage, Rect } from '../lib/messages';

const PANEL_ID = 'snapscreen-panel-root';
const BACKDROP_ID = 'snapscreen-panel-backdrop';
const TOAST_ID = 'snapscreen-toast-root';
const LIGHTBOX_ID = 'snapscreen-lightbox-root';
const MARGIN = VIEWPORT_MARGIN;

const CLOSE_ICON_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

let panelPosition: { top: number; left: number } | null = null;
let panelPositioningAbort: AbortController | null = null;
let lightboxAbort: AbortController | null = null;
let lightboxReturnFocus: HTMLElement | null = null;

export interface ResultPanelOptions {
  dataUrl?: string;
  messages?: DisplayMessage[];
  error?: string;
  errorCode?: string;
  pending?: boolean;
  anchorRect?: Rect;
  onClose: () => void;
  onFollowUp: (text: string) => void;
}

export function showResultPanel(options: ResultPanelOptions): void {
  document.getElementById('snapscreen-overlay-root')?.remove();
  closeScreenshotLightbox();

  let backdrop = document.getElementById(BACKDROP_ID) as HTMLDivElement | null;
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.className = 'snapscreen-panel-backdrop';
    document.documentElement.append(backdrop);
  }

  let root = document.getElementById(PANEL_ID) as HTMLDivElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = PANEL_ID;
    document.documentElement.append(root);
  } else if (root.getBoundingClientRect().width > 0) {
    const rect = root.getBoundingClientRect();
    panelPosition = { top: rect.top, left: rect.left };
  }

  root.className = 'snapscreen-panel';
  root.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'snapscreen-panel-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'snapscreen-panel-title-wrap';

  const icon = document.createElement('img');
  icon.className = 'snapscreen-panel-icon';
  icon.src = chrome.runtime.getURL('src/assets/icons/icon16.png');
  icon.alt = '';
  icon.width = 16;
  icon.height = 16;
  icon.draggable = false;

  const title = document.createElement('span');
  title.className = 'snapscreen-panel-title';
  title.textContent = 'SnapScreen AI';

  titleWrap.append(icon, title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'snapscreen-close-btn';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = CLOSE_ICON_SVG;
  closeBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePanel(root!, options.onClose);
  });

  header.append(titleWrap, closeBtn);
  root.append(header);

  let panelImage: HTMLImageElement | null = null;
  if (options.dataUrl) {
    const thumbBtn = document.createElement('button');
    thumbBtn.type = 'button';
    thumbBtn.className = 'snapscreen-panel-image-btn';
    thumbBtn.setAttribute('aria-label', 'View full-size screenshot');

    const img = document.createElement('img');
    img.className = 'snapscreen-panel-image';
    img.src = options.dataUrl;
    img.alt = 'Captured region screenshot';
    img.draggable = false;

    thumbBtn.append(img);
    thumbBtn.addEventListener('click', () => {
      openScreenshotLightbox(options.dataUrl!, thumbBtn);
    });
    root.append(thumbBtn);
    panelImage = img;
  }

  const body = document.createElement('div');
  body.className = 'snapscreen-panel-body';

  const messages = options.messages ?? [];
  const hasMessages = messages.length > 0;
  const isFatalError = !!options.error && !hasMessages;

  if (isFatalError) {
    appendError(body, options.error!, options.errorCode);
  } else {
    if (hasMessages) {
      const thread = document.createElement('div');
      thread.className = 'snapscreen-chat-thread';

      for (const msg of messages) {
        const bubble = document.createElement('div');
        bubble.className = `snapscreen-msg snapscreen-msg-${msg.role}`;
        bubble.textContent = msg.content;
        thread.append(bubble);
      }

      body.append(thread);
    }

    if (options.pending) {
      body.append(createPendingIndicator());
    }

    if (options.error && hasMessages) {
      appendError(body, options.error, options.errorCode);
    }

    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
    });
  }

  root.append(body);

  const footer = document.createElement('div');
  footer.className = 'snapscreen-panel-footer';

  const composer = document.createElement('div');
  composer.className = 'snapscreen-composer';

  const textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.className = 'snapscreen-input';
  textarea.placeholder = 'Ask about this answer...';
  textarea.disabled = !!options.pending || isFatalError;

  const MAX_TEXTAREA_HEIGHT = 200;
  let singleLineScrollHeight = 0;

  function adjustTextareaHeight(): void {
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    if (!singleLineScrollHeight) {
      singleLineScrollHeight = scrollHeight;
    }
    textarea.style.height = `${Math.min(scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    textarea.style.overflowY =
      scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
    composer.classList.toggle(
      'snapscreen-composer-multiline',
      scrollHeight > singleLineScrollHeight,
    );
  }

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'snapscreen-send-btn';
  sendBtn.setAttribute('aria-label', 'Send');
  sendBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
  sendBtn.disabled = !!options.pending || isFatalError;

  function updateSendState(): void {
    const canSend = !textarea.disabled && textarea.value.trim().length > 0;
    sendBtn.disabled = !canSend;
    sendBtn.classList.toggle('snapscreen-send-btn-active', canSend);
  }

  function submitFollowUp(): void {
    const text = textarea.value.trim();
    if (!text || options.pending) return;
    textarea.value = '';
    textarea.style.height = 'auto';
    adjustTextareaHeight();
    updateSendState();
    options.onFollowUp(text);
  }

  sendBtn.addEventListener('click', submitFollowUp);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitFollowUp();
    }
  });
  textarea.addEventListener('input', () => {
    updateSendState();
    adjustTextareaHeight();
  });

  composer.append(textarea, sendBtn);
  footer.append(composer);
  root.append(footer);

  updateSendState();
  adjustTextareaHeight();
  requestAnimationFrame(adjustTextareaHeight);

  setupDrag(titleWrap, root);
  positionPanel(root, options.anchorRect);
  setupPanelPositioningListeners(root, panelImage, options.onClose);

  backdrop.onclick = () => closePanel(root, options.onClose);
}

function createPendingIndicator(): HTMLElement {
  const pending = document.createElement('div');
  pending.className = 'snapscreen-pending';
  pending.setAttribute('role', 'status');
  pending.setAttribute('aria-label', 'Loading');
  pending.innerHTML = '<div class="snapscreen-spinner"></div>';
  return pending;
}

function appendError(body: HTMLElement, message: string, errorCode?: string): void {
  const err = document.createElement('div');
  err.className = 'snapscreen-error';
  err.textContent = message;

  if (errorCode === 'no_api_key') {
    const btn = document.createElement('button');
    btn.className = 'snapscreen-btn snapscreen-btn-primary';
    btn.textContent = 'Open Settings';
    btn.addEventListener('click', () => chrome.runtime.openOptionsPage());
    err.append(btn);
  }

  body.append(err);
}

function resetPanelCursor(): void {
  document.documentElement.classList.remove('snapscreen-panel-dragging');
  document.body.style.cursor = '';
  document.documentElement.style.cursor = '';
}

function closePanel(root: HTMLElement, onClose: () => void): void {
  closeScreenshotLightbox();
  panelPosition = null;
  panelPositioningAbort?.abort();
  panelPositioningAbort = null;
  resetPanelCursor();
  root.remove();
  document.getElementById(BACKDROP_ID)?.remove();
  onClose();
}

function getLightboxFocusableElements(lightbox: HTMLElement): HTMLElement[] {
  return Array.from(
    lightbox.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
}

function trapFocusInLightbox(lightbox: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;

  const focusable = getLightboxFocusableElements(lightbox);
  if (focusable.length === 0) return;

  if (focusable.length === 1) {
    event.preventDefault();
    focusable[0].focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (event.shiftKey) {
    if (active === first || !lightbox.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (active === last || !lightbox.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

function closeScreenshotLightbox(): void {
  lightboxAbort?.abort();
  lightboxAbort = null;

  const lightbox = document.getElementById(LIGHTBOX_ID);
  lightbox?.remove();

  const returnFocus = lightboxReturnFocus;
  lightboxReturnFocus = null;
  returnFocus?.focus();
}

function openScreenshotLightbox(dataUrl: string, returnFocusEl: HTMLElement): void {
  closeScreenshotLightbox();

  const lightbox = document.createElement('div');
  lightbox.id = LIGHTBOX_ID;
  lightbox.className = 'snapscreen-lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', 'Full-size screenshot');

  const backdrop = document.createElement('div');
  backdrop.className = 'snapscreen-lightbox-backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'snapscreen-lightbox-dialog';
  dialog.tabIndex = -1;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'snapscreen-lightbox-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = CLOSE_ICON_SVG;

  const img = document.createElement('img');
  img.className = 'snapscreen-lightbox-image';
  img.src = dataUrl;
  img.alt = 'Captured region screenshot';
  img.draggable = false;

  dialog.append(closeBtn, img);
  lightbox.append(backdrop, dialog);
  document.documentElement.append(lightbox);

  lightboxReturnFocus = returnFocusEl;

  const abort = new AbortController();
  lightboxAbort = abort;
  const { signal } = abort;

  const close = () => closeScreenshotLightbox();

  closeBtn.addEventListener('click', close, { signal });
  backdrop.addEventListener('click', close, { signal });
  lightbox.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapFocusInLightbox(lightbox, event);
  }, { signal });

  closeBtn.focus();
}

function getViewport(): { width: number; height: number } {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function getPanelSize(panel: HTMLElement): { width: number; height: number } {
  const rect = panel.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }

  return {
    width: panel.offsetWidth,
    height: panel.offsetHeight,
  };
}

function applyPanelPosition(panel: HTMLElement, top: number, left: number): void {
  const size = getPanelSize(panel);
  const clamped = clampToViewport({ top, left }, size, getViewport(), MARGIN);

  panel.style.top = `${clamped.top}px`;
  panel.style.left = `${clamped.left}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panelPosition = clamped;
}

function ensurePanelInViewport(
  panel: HTMLElement,
  preferred?: { top: number; left: number },
  retry = 0,
): void {
  const size = getPanelSize(panel);
  if ((size.width === 0 || size.height === 0) && retry < 2) {
    requestAnimationFrame(() => ensurePanelInViewport(panel, preferred, retry + 1));
    return;
  }

  const current = preferred ?? panelPosition ?? {
    top: panel.getBoundingClientRect().top,
    left: panel.getBoundingClientRect().left,
  };

  applyPanelPosition(panel, current.top, current.left);
}

function getPreferredPanelPosition(anchorRect?: Rect): { top: number; left: number } {
  if (panelPosition) {
    return panelPosition;
  }

  let top = MARGIN;
  let left = MARGIN;

  if (anchorRect) {
    left = anchorRect.x + anchorRect.width + MARGIN;
    top = anchorRect.y;
  }

  return { top, left };
}

function setupPanelPositioningListeners(
  panel: HTMLElement,
  panelImage: HTMLImageElement | null,
  onClose: () => void,
): void {
  panelPositioningAbort?.abort();
  const abort = new AbortController();
  panelPositioningAbort = abort;
  const { signal } = abort;

  const reclamp = () => ensurePanelInViewport(panel);

  window.addEventListener('resize', reclamp, { signal });

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      // The lightbox handles its own Escape; only close the panel when no lightbox is open.
      if (document.getElementById(LIGHTBOX_ID)) return;
      closePanel(panel, onClose);
    },
    { signal, capture: true },
  );

  const resizeObserver = new ResizeObserver(reclamp);
  resizeObserver.observe(panel);
  signal.addEventListener('abort', () => resizeObserver.disconnect());

  if (panelImage) {
    if (panelImage.complete) {
      requestAnimationFrame(reclamp);
    } else {
      panelImage.addEventListener('load', reclamp, { signal });
      panelImage.addEventListener('error', reclamp, { signal });
    }
  }
}

function setupDrag(dragHandle: HTMLElement, panel: HTMLElement): void {
  dragHandle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;

    e.preventDefault();
    dragHandle.setPointerCapture(e.pointerId);

    const rect = panel.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const root = document.documentElement;

    root.classList.add('snapscreen-panel-dragging');
    document.body.style.cursor = 'grabbing';
    root.style.cursor = 'grabbing';

    function onMove(ev: PointerEvent): void {
      applyPanelPosition(panel, ev.clientY - offsetY, ev.clientX - offsetX);
    }

    function onUp(ev: PointerEvent): void {
      if (dragHandle.hasPointerCapture(ev.pointerId)) {
        dragHandle.releasePointerCapture(ev.pointerId);
      }
      resetPanelCursor();
      dragHandle.removeEventListener('pointermove', onMove);
      dragHandle.removeEventListener('pointerup', onUp);
      dragHandle.removeEventListener('pointercancel', onUp);
    }

    dragHandle.addEventListener('pointermove', onMove);
    dragHandle.addEventListener('pointerup', onUp);
    dragHandle.addEventListener('pointercancel', onUp);
    onMove(e);
  });
}

function positionPanel(panel: HTMLElement, anchorRect?: Rect): void {
  panel.style.position = 'fixed';
  panel.style.zIndex = '2147483647';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';

  const preferred = getPreferredPanelPosition(anchorRect);
  applyPanelPosition(panel, preferred.top, preferred.left);
  requestAnimationFrame(() => ensurePanelInViewport(panel, preferred));
}

export function showErrorToast(message: string): void {
  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.className = 'snapscreen-toast';
  toast.textContent = message;
  document.documentElement.append(toast);

  setTimeout(() => toast.remove(), 4000);
}
