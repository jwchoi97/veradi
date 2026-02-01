export type TouchGestureOptions = {
  /** Element that sits above the PDF content (Konva stage container). */
  element: HTMLElement;
  /** Scroll container used for horizontal scrolling (usually overflow-x wrapper). */
  getScrollX: () => HTMLElement | null;
  /** Scroll container used for vertical scrolling (usually document / outer wrapper). */
  getScrollY: () => HTMLElement | null;
  /** Current PDF scale getter/setter (pdf.js PDFViewer). */
  getScale: () => number;
  setScale: (next: number) => void;
  clampScale: (n: number) => number;
};

type Pt = { x: number; y: number };

export function attachTouchGestures(opts: TouchGestureOptions): () => void {
  const el = opts.element;

  // We implement pan/pinch ourselves: disable native browser actions.
  try {
    el.style.touchAction = "none";
  } catch {
    /* ignore */
  }

  const touches = new Map<number, Pt>();
  let pinchStart: null | {
    dist: number;
    scale: number;
    midClient: Pt;
    xRect: DOMRect;
    yRect: DOMRect;
    xScroll: { left: number };
    yScroll: { top: number };
  } = null;

  let raf: number | null = null;

  const readScroll = () => {
    const sx = opts.getScrollX();
    const sy = opts.getScrollY();
    return {
      sx,
      sy,
      xRect: sx?.getBoundingClientRect?.() ?? el.getBoundingClientRect(),
      yRect: sy?.getBoundingClientRect?.() ?? el.getBoundingClientRect(),
      xLeft: sx?.scrollLeft ?? 0,
      yTop: sy?.scrollTop ?? 0,
    };
  };

  const dist2 = (a: Pt, b: Pt) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const applyFromTouches = () => {
    raf = null;

    if (touches.size === 0) {
      pinchStart = null;
      return;
    }

    // One finger: pan/scroll (direct manipulation: drag down => scroll down).
    if (touches.size === 1) {
      const first = touches.values().next().value as Pt;
      const key = touches.keys().next().value as number;
      // We store last position in the map; to compute delta we need prior. Keep a small cache.
      // We encode prior in (el as any).__touchPrev map to avoid re-alloc.
      const prevMap: Map<number, Pt> = (el as any).__touchPrev || new Map();
      (el as any).__touchPrev = prevMap;
      const prev = prevMap.get(key);
      prevMap.set(key, { x: first.x, y: first.y });
      if (!prev) return;

      const dx = first.x - prev.x;
      const dy = first.y - prev.y;
      const sx = opts.getScrollX();
      const sy = opts.getScrollY();
      if (sx) sx.scrollLeft += dx;
      if (sy) sy.scrollTop += dy;
      pinchStart = null;
      return;
    }

    // Two+ fingers: pinch zoom + pan using midpoint.
    const pts = Array.from(touches.values());
    const a = pts[0]!;
    const b = pts[1]!;
    const d = Math.max(1, dist2(a, b));
    const mid = midpoint(a, b);

    if (!pinchStart) {
      const s = readScroll();
      pinchStart = {
        dist: d,
        scale: opts.getScale(),
        midClient: mid,
        xRect: s.xRect,
        yRect: s.yRect,
        xScroll: { left: s.xLeft },
        yScroll: { top: s.yTop },
      };
      return;
    }

    const ratio = d / Math.max(1, pinchStart.dist);
    const nextScale = opts.clampScale(pinchStart.scale * ratio);
    opts.setScale(nextScale);

    // Keep the content under the midpoint stable (approx).
    const sx = opts.getScrollX();
    const sy = opts.getScrollY();
    const scaleRatio = nextScale / Math.max(0.0001, pinchStart.scale);

    if (sx) {
      const midXInView = mid.x - pinchStart.xRect.left;
      const contentX = pinchStart.xScroll.left + midXInView;
      sx.scrollLeft = contentX * scaleRatio - midXInView;
    }
    if (sy) {
      const midYInView = mid.y - pinchStart.yRect.top;
      const contentY = pinchStart.yScroll.top + midYInView;
      sy.scrollTop = contentY * scaleRatio - midYInView;
    }
  };

  const scheduleApply = (e?: PointerEvent) => {
    if (raf != null) return;
    raf = window.requestAnimationFrame(applyFromTouches);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (String((e as any).pointerType || "") !== "touch") return;
    try {
      e.preventDefault();
    } catch {
      /* ignore */
    }
    try {
      (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    scheduleApply(e);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (String((e as any).pointerType || "") !== "touch") return;
    if (!touches.has(e.pointerId)) return;
    try {
      e.preventDefault();
    } catch {
      /* ignore */
    }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    scheduleApply(e);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (String((e as any).pointerType || "") !== "touch") return;
    try {
      e.preventDefault();
    } catch {
      /* ignore */
    }
    touches.delete(e.pointerId);
    scheduleApply(e);
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (String((e as any).pointerType || "") !== "touch") return;
    touches.delete(e.pointerId);
    scheduleApply(e);
  };

  el.addEventListener("pointerdown", onPointerDown, { capture: true });
  el.addEventListener("pointermove", onPointerMove, { capture: true });
  el.addEventListener("pointerup", onPointerUp, { capture: true });
  el.addEventListener("pointercancel", onPointerCancel, { capture: true });

  return () => {
    try {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
      el.removeEventListener("pointermove", onPointerMove, { capture: true } as any);
      el.removeEventListener("pointerup", onPointerUp, { capture: true } as any);
      el.removeEventListener("pointercancel", onPointerCancel, { capture: true } as any);
    } catch {
      /* ignore */
    }
    try {
      if (raf != null) window.cancelAnimationFrame(raf);
    } catch {
      /* ignore */
    }
    raf = null;
    touches.clear();
    pinchStart = null;
  };
}

