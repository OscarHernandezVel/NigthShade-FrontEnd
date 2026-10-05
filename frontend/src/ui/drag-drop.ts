export interface SortableOptions {
  container: HTMLElement;
  itemSelector: string;
  /** Element inside an item that starts a drag. Defaults to the whole item. */
  handleSelector?: string;
  onMove(from: number, to: number): void;
  /** Elements outside the list that accept a dropped item (e.g. sidebar playlists). */
  dropTargetSelector?: string;
  onDropOnTarget?(from: number, target: HTMLElement): void;
}

const DRAG_THRESHOLD = 6;
const EDGE_SCROLL = 48;

interface DragState {
  item: HTMLElement;
  from: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  dragging: boolean;
  ghost?: HTMLElement;
  indicator?: HTMLElement;
  to: number;
  target: HTMLElement | null;
}

/**
 * Pointer-event drag & drop: a ghost follows the cursor, an indicator marks the
 * insertion point, and the result is reported as (from, to) indices so the
 * caller can relink its doubly linked list. Alt+ArrowUp/Down reorders by keyboard.
 */
export function makeSortable(options: SortableOptions): () => void {
  const { container, itemSelector, handleSelector } = options;
  const items = () => Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  let state: DragState | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || state) return;
    const origin = event.target as Element;
    const handle = origin.closest(handleSelector ?? itemSelector);
    if (!handle || !container.contains(handle)) return;
    if (!handleSelector && origin.closest('button, input, select, a, textarea')) return;
    const item = handle.closest<HTMLElement>(itemSelector);
    if (!item) return;
    const rect = item.getBoundingClientRect();
    state = {
      item,
      from: items().indexOf(item),
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerId: event.pointerId,
      dragging: false,
      to: -1,
      target: null,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', cancel);
  };

  const begin = (current: DragState) => {
    const rect = current.item.getBoundingClientRect();
    const ghost = current.item.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('id');
    ghost.style.width = `${rect.width}px`;
    document.body.appendChild(ghost);
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    container.appendChild(indicator);
    current.item.classList.add('is-dragging');
    document.body.classList.add('is-sorting');
    current.ghost = ghost;
    current.indicator = indicator;
    current.dragging = true;
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = state;
    if (!current || event.pointerId !== current.pointerId) return;
    if (!current.dragging) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD) return;
      begin(current);
    }
    event.preventDefault();
    const ghost = current.ghost!;
    const indicator = current.indicator!;
    ghost.style.transform = `translate(${event.clientX - current.offsetX}px, ${event.clientY - current.offsetY}px) rotate(-1.5deg)`;

    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const target = options.dropTargetSelector ? (hit?.closest<HTMLElement>(options.dropTargetSelector) ?? null) : null;
    if (target !== current.target) {
      current.target?.classList.remove('is-drop-target');
      target?.classList.add('is-drop-target');
      current.target = target;
    }
    if (target) {
      indicator.hidden = true;
      return;
    }

    // Insertion index among the other items (the dragged one is excluded).
    const others = items().filter((el) => el !== current.item);
    let to = others.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return event.clientY < r.top + r.height / 2;
    });
    if (to === -1) to = others.length;
    current.to = to;

    const box = container.getBoundingClientRect();
    const anchor = others[to] ?? others[others.length - 1];
    let y = 0;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      y = (others[to] ? r.top : r.bottom) - box.top + container.scrollTop;
    }
    indicator.hidden = false;
    indicator.style.transform = `translateY(${y - 1}px)`;

    if (event.clientY < box.top + EDGE_SCROLL) container.scrollTop -= 12;
    else if (event.clientY > box.bottom - EDGE_SCROLL) container.scrollTop += 12;
  };

  const finish = (commit: boolean) => {
    const current = state;
    if (!current) return;
    current.ghost?.remove();
    current.indicator?.remove();
    current.item.classList.remove('is-dragging');
    current.target?.classList.remove('is-drop-target');
    document.body.classList.remove('is-sorting');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', cancel);
    state = null;
    if (!commit || !current.dragging) return;
    if (current.target) options.onDropOnTarget?.(current.from, current.target);
    else if (current.to !== -1 && current.to !== current.from) options.onMove(current.from, current.to);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (state && event.pointerId === state.pointerId) finish(true);
  };
  const cancel = () => finish(false);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const item = (event.target as Element).closest<HTMLElement>(itemSelector);
    if (!item) return;
    const list = items();
    const from = list.indexOf(item);
    const to = from + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= list.length) return;
    event.preventDefault();
    options.onMove(from, to);
    requestAnimationFrame(() => items()[to]?.focus());
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('keydown', onKeyDown);
  return () => {
    finish(false);
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('keydown', onKeyDown);
  };
}
