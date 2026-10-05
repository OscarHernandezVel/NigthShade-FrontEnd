type DecoKind = 'pumpkin' | 'bat' | 'hat';

interface Deco {
  el: HTMLElement;
  kind: DecoKind;
  /** Pumpkins: true flees from the cursor, false comes closer. */
  shy: boolean;
  depth: number;
}

const RADIUS = 170;

const SVG: Record<DecoKind, string> = {
  pumpkin: `<svg viewBox="0 0 70 62" aria-hidden="true">
    <path d="M33 4c3-3 8-3 9 1l-3 9h-6z" fill="#5a2d8c"/>
    <path d="M20 17a16 21 0 1 0 1 42 16 21 0 0 0-1-42z" fill="#e06a00"/>
    <path d="M50 17a16 21 0 1 1-1 42 16 21 0 0 1 1-42z" fill="#e06a00"/>
    <ellipse cx="35" cy="38" rx="16" ry="23" fill="#ff8c00"/>
    <path d="M28 33l4 4h-6zM42 33l2 4h-6zM27 46q8 5 16 0" stroke="#22103a" stroke-width="2.4" fill="#22103a" stroke-linejoin="round"/></svg>`,
  bat: `<svg viewBox="0 0 64 32" aria-hidden="true">
    <path class="wing" d="M32 14C26 6 14 2 2 6c6 2 9 6 9 11 4-3 8-3 11 0 2-3 6-4 10-3z" fill="#3b1d5e"/>
    <path class="wing wing-r" d="M32 14c6-8 18-12 30-8-6 2-9 6-9 11-4-3-8-3-11 0-2-3-6-4-10-3z" fill="#3b1d5e"/>
    <ellipse cx="32" cy="17" rx="6" ry="8" fill="#1d0f30"/><path d="M27 10l2 4h6l2-4-3 2h-4z" fill="#1d0f30"/>
    <circle cx="29.5" cy="16" r="1.4" fill="#ff8c00"/><circle cx="34.5" cy="16" r="1.4" fill="#ff8c00"/></svg>`,
  hat: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M8 50c8-4 40-4 48 0-6 5-42 5-48 0z" fill="#1d0f30"/>
    <path d="M18 48c2-14 8-28 22-40-2 8 0 12 4 14-6 6-8 16-6 26z" fill="#5a2d8c"/>
    <path d="M19 43c6-2 14-2 20 0l-1 5c-6-1-12-1-18 0z" fill="#ff8c00"/></svg>`,
};

/** Scatters cursor-reactive decorations over `layer`. Returns a cleanup function. */
export function mountHalloween(layer: HTMLElement): () => void {
  const small = window.matchMedia('(max-width: 720px)').matches;
  const counts: Record<DecoKind, number> = small ? { pumpkin: 3, bat: 4, hat: 3 } : { pumpkin: 7, bat: 9, hat: 6 };
  const items: Deco[] = [];

  (Object.keys(counts) as DecoKind[]).forEach((kind) => {
    for (let i = 0; i < counts[kind]; i++) {
      const el = document.createElement('div');
      el.className = `deco deco-${kind}`;
      el.innerHTML = `<div class="deco-inner" style="animation-delay:${(-Math.random() * 6).toFixed(2)}s">${SVG[kind]}</div>`;
      el.style.left = `${4 + Math.random() * 90}%`;
      el.style.top = `${4 + Math.random() * 88}%`;
      layer.appendChild(el);
      items.push({ el, kind, shy: i % 2 === 0, depth: 0.4 + Math.random() * 0.9 });
    }
  });

  let pointer: { x: number; y: number } | null = null;
  let frame = 0;

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const onMove = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  };
  const onLeave = () => {
    pointer = null;
    schedule();
  };

  function update() {
    frame = 0;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    for (const item of items) {
      const { el } = item;
      if (!pointer) {
        el.style.transform = '';
        el.style.opacity = '';
        el.classList.remove('is-near');
        continue;
      }
      // offsetLeft/Top ignore transforms, so this is the resting centre.
      const restX = el.offsetLeft + el.offsetWidth / 2;
      const restY = el.offsetTop + el.offsetHeight / 2;
      const dx = restX - pointer.x;
      const dy = restY - pointer.y;
      const dist = Math.hypot(dx, dy) || 1;
      const near = dist < RADIUS;
      const k = near ? 1 - dist / RADIUS : 0;
      const ux = dx / dist;
      const uy = dy / dist;
      el.classList.toggle('is-near', near);

      if (item.kind === 'pumpkin') {
        const push = (item.shy ? 80 : -45) * k;
        el.style.transform = `translate(${ux * push}px, ${uy * push}px) scale(${1 + 0.35 * k}) rotate(${ux * 16 * k}deg)`;
        el.style.opacity = String(0.55 + 0.45 * k);
      } else if (item.kind === 'bat') {
        // Every bat drifts with the mouse (parallax); close ones dart away.
        const driftX = (pointer.x - cx) * 0.06 * item.depth;
        const driftY = (pointer.y - cy) * 0.04 * item.depth;
        const flee = 70 * k;
        el.style.transform = `translate(${driftX + ux * flee}px, ${driftY + uy * flee - 12 * k}px) scale(${0.85 + 0.2 * item.depth + 0.3 * k}) rotate(${-ux * 24 * k}deg)`;
        el.style.opacity = String(0.45 + 0.25 * item.depth + 0.3 * k);
      } else {
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        el.style.transform = `rotate(${(angle / 6) * k + 28 * k}deg) scale(${1 + 0.25 * k}) translateY(${-14 * k}px)`;
        el.style.opacity = String(0.35 + 0.65 * k);
      }
    }
  }

  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    layer.replaceChildren();
  };
}
