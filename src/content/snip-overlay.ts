import type { Rect } from '../lib/messages';

const MIN_SIZE = 5;
const ROOT_ID = 'snapscreen-overlay-root';

function afterNextPaint(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

export interface SnipOverlayOptions {
  hintText?: string;
  onRegionSelected: (rect: Rect) => void;
  onCancelled: () => void;
}

export function startSnipOverlay(options: SnipOverlayOptions): void {
  removeExisting();

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'snapscreen-overlay';

  const dim = document.createElement('div');
  dim.className = 'snapscreen-dim';

  const selection = document.createElement('div');
  selection.className = 'snapscreen-selection';
  selection.hidden = true;

  const hint = document.createElement('div');
  hint.className = 'snapscreen-hint';
  hint.textContent = options.hintText ?? 'Drag to select a region · Click to cancel';

  const sizeBadge = document.createElement('div');
  sizeBadge.className = 'snapscreen-size-badge';
  sizeBadge.hidden = true;

  root.append(dim, selection, sizeBadge, hint);
  document.documentElement.append(root);

  let startX = 0;
  let startY = 0;
  let dragging = false;

  function updateSelection(x: number, y: number, w: number, h: number): void {
    selection.hidden = false;
    selection.style.left = `${x}px`;
    selection.style.top = `${y}px`;
    selection.style.width = `${w}px`;
    selection.style.height = `${h}px`;

    sizeBadge.hidden = false;
    sizeBadge.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    sizeBadge.style.left = `${Math.min(x + w + 8, window.innerWidth - 90)}px`;
    sizeBadge.style.top = `${Math.min(y + h + 8, window.innerHeight - 30)}px`;
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    updateSelection(startX, startY, 0, 0);
    e.preventDefault();
  }

  function onMouseMove(e: MouseEvent): void {
    if (!dragging) return;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    updateSelection(x, y, w, h);
  }

  function cancel(): void {
    teardown();
    options.onCancelled();
  }

  function onMouseUp(e: MouseEvent): void {
    if (!dragging) return;
    dragging = false;

    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);

    if (width < MIN_SIZE || height < MIN_SIZE) {
      cancel();
      return;
    }

    teardown();
    afterNextPaint(() => options.onRegionSelected({ x, y, width, height }));
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      cancel();
    }
  }

  function teardown(): void {
    root.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onKeyDown, true);
    root.style.display = 'none';
    root.remove();
  }

  root.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown, true);
}

function removeExisting(): void {
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById('snapscreen-panel-root')?.remove();
  document.getElementById('snapscreen-panel-backdrop')?.remove();
  document.getElementById('snapscreen-toast-root')?.remove();
}
