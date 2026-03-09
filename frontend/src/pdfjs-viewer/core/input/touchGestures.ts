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
  /**
   * Optional pinch-preview hook.
   * If provided, pinch move avoids per-frame setScale and uses transient CSS transform.
   */
  setPinchPreviewScale?: (
    ratio: number,
    startMidClient: { x: number; y: number },
    currentMidClient: { x: number; y: number }
  ) => void;
  clearPinchPreviewScale?: () => void;
  /** Optional hook: called when pinch state enters/leaves active mode. */
  onPinchActiveChange?: (active: boolean) => void;
};

type Pt = { x: number; y: number };
type PrevPt = { x: number; y: number; t: number };
type Vel = { vx: number; vy: number };

export function attachTouchGestures(opts: TouchGestureOptions): () => void {
  const el = opts.element;

  // We implement pan/pinch ourselves: disable native browser actions.
  try {
    el.style.touchAction = "none";
  } catch {
    /* ignore */
  }

  const touches = new Map<number, Pt>();
  const prevById = new Map<number, PrevPt>();
  const velById = new Map<number, Vel>();
  let pinchStart: null | {
    dist: number;
    scale: number;
    midClient: Pt;
    anchorBaseX: number;
    anchorBaseY: number;
  } = null;

  let raf: number | null = null;

  // Momentum scrolling (one-finger pan end).
  let inertiaRaf: number | null = null;
  let inertiaVel: Vel = { vx: 0, vy: 0 }; // px/ms in scroll space
  let inertiaLastT = 0;

  let lastGesture: "none" | "pan" | "pinch" = "none";
  let lastPanVel: Vel = { vx: 0, vy: 0 };
  let lastPanAt = 0;
  let lastPinch: null | { nextScale: number; midClient: Pt } = null;
  let lastPinchScaleApplyAt = 0;
  const pinchScaleIntervalMs = 50;

  const stopInertia = () => {
    if (inertiaRaf != null) {
      try {
        window.cancelAnimationFrame(inertiaRaf);
      } catch {
        /* ignore */
      }
    }
    inertiaRaf = null;
    inertiaVel = { vx: 0, vy: 0 };
    inertiaLastT = 0;
  };

  const startInertia = (v: Vel) => {
    stopInertia();
    inertiaVel = { vx: v.vx, vy: v.vy };
    inertiaLastT = performance.now();

    const step = () => {
      inertiaRaf = null;
      const now = performance.now();
      const dt = Math.max(0, now - inertiaLastT);
      inertiaLastT = now;

      // If user started touching again, inertia will be cancelled in onPointerDown.
      const sx = opts.getScrollX();
      const sy = opts.getScrollY();

      if (sx && inertiaVel.vx !== 0) {
        const before = sx.scrollLeft;
        sx.scrollLeft = before + inertiaVel.vx * dt;
        // If clamped by bounds, kill that axis velocity.
        if (sx.scrollLeft === before) inertiaVel.vx = 0;
      }
      if (sy && inertiaVel.vy !== 0) {
        const before = sy.scrollTop;
        sy.scrollTop = before + inertiaVel.vy * dt;
        if (sy.scrollTop === before) inertiaVel.vy = 0;
      }

      // Exponential decay tuned for "natural" tablet feel.
      // 0.92 per 60fps frame ~= quick but smooth slowdown.
      const decay = Math.pow(0.92, dt / 16.6667);
      inertiaVel.vx *= decay;
      inertiaVel.vy *= decay;

      const stopThreshold = 0.02; // px/ms ~= 20px/s
      if (Math.abs(inertiaVel.vx) < stopThreshold) inertiaVel.vx = 0;
      if (Math.abs(inertiaVel.vy) < stopThreshold) inertiaVel.vy = 0;

      if (inertiaVel.vx === 0 && inertiaVel.vy === 0) {
        stopInertia();
        return;
      }
      inertiaRaf = window.requestAnimationFrame(step);
    };

    inertiaRaf = window.requestAnimationFrame(step);
  };

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

  const applyPinchScaleAndAnchor = (nextScale: number, midClient: Pt) => {
    if (!pinchStart) return;
    try {
      opts.setScale(nextScale);
    } catch {
      /* ignore */
    }
    const sx = opts.getScrollX();
    const sy = opts.getScrollY();
    if (sx) {
      const xr = sx.getBoundingClientRect?.() ?? el.getBoundingClientRect();
      const midXInView = midClient.x - xr.left;
      sx.scrollLeft = pinchStart.anchorBaseX * nextScale - midXInView;
    }
    if (sy) {
      const yr = sy.getBoundingClientRect?.() ?? el.getBoundingClientRect();
      const midYInView = midClient.y - yr.top;
      sy.scrollTop = pinchStart.anchorBaseY * nextScale - midYInView;
    }
  };

  const applyPinchScaleAndAnchorFrom = (
    start: { anchorBaseX: number; anchorBaseY: number },
    nextScale: number,
    midClient: Pt
  ) => {
    try {
      opts.setScale(nextScale);
    } catch {
      /* ignore */
    }
    const sx = opts.getScrollX();
    const sy = opts.getScrollY();
    if (sx) {
      const xr = sx.getBoundingClientRect?.() ?? el.getBoundingClientRect();
      const midXInView = midClient.x - xr.left;
      sx.scrollLeft = start.anchorBaseX * nextScale - midXInView;
    }
    if (sy) {
      const yr = sy.getBoundingClientRect?.() ?? el.getBoundingClientRect();
      const midYInView = midClient.y - yr.top;
      sy.scrollTop = start.anchorBaseY * nextScale - midYInView;
    }
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
      lastGesture = "none";
      lastPinch = null;
      try {
        opts.clearPinchPreviewScale?.();
      } catch {
        /* ignore */
      }
      return;
    }

    // One finger: pan/scroll (direct manipulation: drag down => scroll down).
    if (touches.size === 1) {
      const first = touches.values().next().value as Pt;
      const key = touches.keys().next().value as number;
      const now = performance.now();
      const prev = prevById.get(key);
      prevById.set(key, { x: first.x, y: first.y, t: now });
      if (!prev) return;

      const rawDx = first.x - prev.x;
      const rawDy = first.y - prev.y;

      // IMPORTANT:
      // "Grab & push page" should feel opposite to scroll-bar direction.
      // Typical touch UX: finger moves UP => scroll DOWN (scrollTop increases).
      const dx = -rawDx;
      const dy = -rawDy;
      const sx = opts.getScrollX();
      const sy = opts.getScrollY();
      if (sx) sx.scrollLeft += dx;
      if (sy) sy.scrollTop += dy;
      pinchStart = null;

      // Track scroll-space velocity for inertia.
      const dt = Math.max(1, now - prev.t);
      const instVx = dx / dt;
      const instVy = dy / dt;
      const prevVel = velById.get(key) || { vx: 0, vy: 0 };
      // Low-pass filter to reduce jitter.
      const alpha = 0.2;
      const nextVel = {
        vx: prevVel.vx * (1 - alpha) + instVx * alpha,
        vy: prevVel.vy * (1 - alpha) + instVy * alpha,
      };
      velById.set(key, nextVel);
      lastGesture = "pan";
      lastPanVel = nextVel;
      lastPanAt = now;
      return;
    }

    // Two+ fingers: pinch zoom + pan using midpoint.
    lastGesture = "pinch";
    const pts = Array.from(touches.values());
    const a = pts[0]!;
    const b = pts[1]!;
    const d = Math.max(1, dist2(a, b));
    const mid = midpoint(a, b);

    if (!pinchStart) {
      const s = readScroll();
      const startMidXInView = mid.x - s.xRect.left;
      const startMidYInView = mid.y - s.yRect.top;
      const anchorContentX = s.xLeft + startMidXInView;
      const anchorContentY = s.yTop + startMidYInView;
      const baseScale = Math.max(0.0001, opts.getScale());
      pinchStart = {
        dist: d,
        scale: baseScale,
        midClient: mid,
        anchorBaseX: anchorContentX / baseScale,
        anchorBaseY: anchorContentY / baseScale,
      };
      try {
        opts.onPinchActiveChange?.(true);
      } catch {
        /* ignore */
      }
      return;
    }

    const ratio = d / Math.max(1, pinchStart.dist);
    const nextScale = opts.clampScale(pinchStart.scale * ratio);
    lastPinch = { nextScale, midClient: mid };
    if (opts.setPinchPreviewScale) {
      const previewRatio = nextScale / Math.max(0.0001, pinchStart.scale);
      try {
        opts.setPinchPreviewScale(previewRatio, pinchStart.midClient, mid);
      } catch {
        /* ignore */
      }
      return;
    }
    // Throttle live relayout work while preserving one canonical coordinate mapping.
    const now = performance.now();
    const shouldApplyLive =
      lastPinchScaleApplyAt === 0 ||
      now - lastPinchScaleApplyAt >= pinchScaleIntervalMs ||
      Math.abs(nextScale - opts.getScale()) >= 0.08;
    if (!shouldApplyLive) return;
    lastPinchScaleApplyAt = now;
    applyPinchScaleAndAnchor(nextScale, mid);
  };

  const scheduleApply = () => {
    if (raf != null) return;
    raf = window.requestAnimationFrame(applyFromTouches);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    // Touch down should immediately stop momentum.
    stopInertia();
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
    const now = performance.now();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Seed prev so first move doesn't jump.
    prevById.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now });
    velById.set(e.pointerId, { vx: 0, vy: 0 });
    scheduleApply();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (!touches.has(e.pointerId)) return;
    try {
      e.preventDefault();
    } catch {
      /* ignore */
    }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    scheduleApply();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    try {
      e.preventDefault();
    } catch {
      /* ignore */
    }
    touches.delete(e.pointerId);
    prevById.delete(e.pointerId);
    velById.delete(e.pointerId);

    // If a pinch just ended (2->1 or 2->0), commit the scale once.
    if (pinchStart && lastGesture === "pinch" && touches.size < 2 && lastPinch) {
      const finalScale = opts.clampScale(lastPinch.nextScale);
      const finalMid = lastPinch.midClient;
      const startForCommit = {
        anchorBaseX: pinchStart.anchorBaseX,
        anchorBaseY: pinchStart.anchorBaseY,
      };
      // Final commit in next frame keeps layout measurement and scroll rects in sync.
      try {
        requestAnimationFrame(() => {
          try {
            opts.clearPinchPreviewScale?.();
          } catch {
            /* ignore */
          }
          applyPinchScaleAndAnchorFrom(startForCommit, finalScale, finalMid);
        });
      } catch {
        /* ignore */
      }
      pinchStart = null;
      lastPinch = null;
      lastPinchScaleApplyAt = 0;
      // If one finger remains after pinch, reseed prev to avoid a jump into pan.
      if (touches.size === 1) {
        const key = touches.keys().next().value as number;
        const pt = touches.get(key);
        if (pt) {
          const now = performance.now();
          prevById.set(key, { x: pt.x, y: pt.y, t: now });
          velById.set(key, { vx: 0, vy: 0 });
        }
      }
      try {
        opts.onPinchActiveChange?.(false);
      } catch {
        /* ignore */
      }
      // Do not start inertia from the tail of a pinch.
      lastGesture = "none";
      scheduleApply();
      return;
    }

    // Start inertia when the last finger lifts after a pan.
    if (touches.size === 0 && lastGesture === "pan") {
      const now = performance.now();
      const age = now - lastPanAt;
      // If the last movement was too long ago, don't fling.
      if (age < 120) {
        const maxV = 3.0; // px/ms (3000 px/s) cap to avoid insane fling
        const vx = Math.max(-maxV, Math.min(maxV, lastPanVel.vx));
        const vy = Math.max(-maxV, Math.min(maxV, lastPanVel.vy));
        const minSpeed = 0.05; // px/ms ~= 50px/s
        if (Math.abs(vx) >= minSpeed || Math.abs(vy) >= minSpeed) {
          startInertia({ vx, vy });
        }
      }
    }
    scheduleApply();
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.delete(e.pointerId);
    prevById.delete(e.pointerId);
    velById.delete(e.pointerId);
    if (touches.size < 2) {
      pinchStart = null;
      lastPinch = null;
      lastPinchScaleApplyAt = 0;
      try {
        opts.onPinchActiveChange?.(false);
      } catch {
        /* ignore */
      }
      try {
        opts.clearPinchPreviewScale?.();
      } catch {
        /* ignore */
      }
    }
    scheduleApply();
  };

  el.addEventListener("pointerdown", onPointerDown, { capture: true });
  el.addEventListener("pointermove", onPointerMove, { capture: true });
  el.addEventListener("pointerup", onPointerUp, { capture: true });
  el.addEventListener("pointercancel", onPointerCancel, { capture: true });

  return () => {
    try {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      el.removeEventListener("pointermove", onPointerMove, { capture: true });
      el.removeEventListener("pointerup", onPointerUp, { capture: true });
      el.removeEventListener("pointercancel", onPointerCancel, { capture: true });
    } catch {
      /* ignore */
    }
    try {
      if (raf != null) window.cancelAnimationFrame(raf);
    } catch {
      /* ignore */
    }
    raf = null;
    stopInertia();
    touches.clear();
    prevById.clear();
    velById.clear();
    pinchStart = null;
    lastPinch = null;
    lastPinchScaleApplyAt = 0;
    try {
      opts.onPinchActiveChange?.(false);
    } catch {
      /* ignore */
    }
    try {
      opts.clearPinchPreviewScale?.();
    } catch {
      /* ignore */
    }
  };
}

