import Konva from "konva";
import type { Annotation, AnnotationType, PageMetrics } from "../model/types";
import { loadAnnotations, saveAnnotations } from "../../api/annotations";
import { computePageMetricsFromPdfLayout } from "../layout/PageLayoutProvider";
import { applyStyleToRuns as applyStyleToTextRuns, normalizeTextRuns as normalizeTextRunsUtil, type TextRun } from "../text/textRuns";
import { getPointerKind } from "../input/pointer";

type EngineEvents = {
  modeChanged: AnnotationType;
};

type PageSnapshot = Record<number, Annotation[] | null>;
type UndoEntry = {
  pages: number[];
  before: PageSnapshot;
  after: PageSnapshot;
};

export class KonvaAnnotationManager {
  // Lifecycle safety:
  // - In React StrictMode (dev), effects can mount/unmount twice.
  // - `init()` awaits network; meanwhile `destroy()` may run.
  // Guard async continuations so we never touch Konva layers after destroy.
  private destroyed = false;
  private initSeq = 0;

  private listeners: Partial<Record<keyof EngineEvents, Set<(payload: any) => void>>> = {};
  on<K extends keyof EngineEvents>(event: K, handler: (payload: EngineEvents[K]) => void): () => void {
    const set = (this.listeners[event] ??= new Set());
    set.add(handler as any);
    return () => this.off(event, handler);
  }
  off<K extends keyof EngineEvents>(event: K, handler: (payload: EngineEvents[K]) => void) {
    this.listeners[event]?.delete(handler as any);
  }
  private emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]) {
    const set = this.listeners[event];
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      try {
        (fn as any)(payload);
      } catch {
        /* ignore */
      }
    }
  }

  private annotations: Record<number, Annotation[]> = {};
  private currentMode: AnnotationType = "none";
  private pageMetrics: Map<number, PageMetrics> = new Map();
  private pageGroups: Map<number, Konva.Group> = new Map();

  private stageContainerEl: HTMLDivElement | null = null;
  private stage: Konva.Stage | null = null;
  private contentLayer: Konva.Layer | null = null;
  private uiLayer: Konva.Layer | null = null;
  private transformer: Konva.Transformer | null = null;

  // Viewport-sized stage for performance:
  // We keep Konva's canvas buffer limited to the *visible viewport* rather than the entire document.
  // The "camera" is implemented by translating layers by (-viewOffset.x, -viewOffset.y).
  private viewOffset = { x: 0, y: 0 }; // document coords of viewport top-left
  private viewportSyncRaf: number | null = null;
  private viewportCleanupFns: Array<() => void> = [];

  private selectedNodes: Konva.Node[] = [];
  private activePage: number | null = null;

  // selection drag handle (drag within transformer box)
  private selectionHitRect: Konva.Rect | null = null;
  private selectionDeleteBtn: Konva.Group | null = null;
  private isSelectionDragging = false;
  /** Document-space position where the selection drag started (so it stays under cursor after scroll). */
  private selectionDragStart: { x: number; y: number } | null = null;
  /** Document-space positions of each selected node at drag start. */
  private selectionDragStartNodes: Array<{ node: Konva.Node; docX: number; docY: number }> = [];

  // marquee selection (none mode)
  private isMarqueeSelecting = false;
  private marqueeStart: { x: number; y: number } | null = null;
  private marqueeRect: Konva.Rect | null = null;
  private marqueeAdditive = false;

  // drawing
  private isDrawing = false;
  private currentDrawing: Konva.Line | null = null;
  private currentPoints: number[] = [];
  private isErasing = false;
  private lastErasedId: string | null = null;

  // textbox drag-create preview
  private isTextBoxCreating = false;
  private textBoxStart: { page: number; x: number; y: number } | null = null;
  private textBoxPreview: Konva.Rect | null = null;

  // settings
  private inkSettings = { color: "#111827", width: 2 };
  private highlightSettings = { color: "#FFF066", opacity: 0.75 };

  // editor overlay
  private textEditingOverlay: HTMLDivElement | null = null;
  private textEditingInput: HTMLElement | null = null;

  // highlight (native text selection) DOM hook
  private highlightSelectionCleanup: (() => void) | null = null;

  // highlight DOM rendering (behind textLayer)
  private highlightDomLayerByPage: Map<number, HTMLDivElement> = new Map();
  private highlightDomById: Map<string, HTMLDivElement> = new Map();

  private stageToDoc(pos: { x: number; y: number }) {
    return { x: pos.x + this.viewOffset.x, y: pos.y + this.viewOffset.y };
  }

  private getContentSizeFromPageMetrics(): { w: number; h: number } {
    // Document-space size (used only to clamp viewport offsets so we don't inflate scroll ranges)
    let w = 1;
    let h = 1;
    if (this.pageMetrics.size > 0) {
      let maxX = 0;
      let maxY = 0;
      for (const m of this.pageMetrics.values()) {
        maxX = Math.max(maxX, (m.x || 0) + (m.width || 0));
        maxY = Math.max(maxY, (m.y || 0) + (m.height || 0));
      }
      w = Math.max(1, Math.ceil(maxX + 1));
      h = Math.max(1, Math.ceil(maxY + 1));
      return { w, h };
    }
    try {
      w = Math.max(1, this.container.scrollWidth || 1);
      h = Math.max(1, this.container.scrollHeight || 1);
    } catch {
      w = 1;
      h = 1;
    }
    return { w, h };
  }

  private hasScrollStyle(el: HTMLElement, axis: "x" | "y") {
    try {
      const style = window.getComputedStyle(el);
      const ov = axis === "x" ? style.overflowX : style.overflowY;
      const hasOverflowStyle =
        ov === "auto" ||
        ov === "scroll" ||
        el.classList.toString().includes(axis === "x" ? "overflow-x-auto" : "overflow-y-auto") ||
        el.classList.toString().includes(axis === "x" ? "overflow-x-scroll" : "overflow-y-scroll");
      return hasOverflowStyle;
    } catch {
      return false;
    }
  }

  private getScrollParent(axis: "x" | "y"): HTMLElement | null {
    // Find nearest clip/scroll container ancestor for the axis.
    // We key off overflow style (not current scrollability) because the element still defines the viewport.
    // For Y, fall back to document.scrollingElement.
    try {
      let el: HTMLElement | null = this.container.parentElement as HTMLElement | null;
      while (el) {
        if (this.hasScrollStyle(el, axis)) return el;
        el = el.parentElement as HTMLElement | null;
      }
    } catch {
      /* ignore */
    }
    if (axis === "y") return (document.scrollingElement as HTMLElement | null) ?? null;
    return null;
  }

  private getViewportClientRect(): { left: number; top: number; right: number; bottom: number } | null {
    // Visible area is intersection of:
    // - horizontal clip viewport (x-scroll wrapper)
    // - vertical clip viewport (outer scroll container / window)
    const rectFromEl = (el: HTMLElement | null, axis: "x" | "y") => {
      if (!el) return null;
      // Treat document scrolling element as full viewport.
      try {
        const se = document.scrollingElement as any;
        if (axis === "y" && (el === se || el === document.documentElement || el === document.body)) {
          return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        }
      } catch {
        /* ignore */
      }
      try {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      } catch {
        return null;
      }
    };

    const xr = rectFromEl(this.getScrollParent("x"), "x") ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const yr = rectFromEl(this.getScrollParent("y"), "y") ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };

    const left = Math.max(xr.left, yr.left);
    const top = Math.max(xr.top, yr.top);
    const right = Math.min(xr.right, yr.right);
    const bottom = Math.min(xr.bottom, yr.bottom);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) return null;
    if (right - left < 1 || bottom - top < 1) return null;
    return { left, top, right, bottom };
  }

  private scheduleViewportSync() {
    if (this.viewportSyncRaf != null) return;
    try {
      this.viewportSyncRaf = window.requestAnimationFrame(() => {
        this.viewportSyncRaf = null;
        this.applyViewportSync();
      });
    } catch {
      this.viewportSyncRaf = null;
      this.applyViewportSync();
    }
  }

  private applyViewportSync() {
    if (!this.stage || !this.stageContainerEl || !this.contentLayer || !this.uiLayer) return;
    const clip = this.getViewportClientRect();
    const cr = this.container.getBoundingClientRect?.();
    if (!clip || !cr) return;

    // Viewport in document-space coordinates (container-local, same space as pageMetrics)
    const rawX = clip.left - cr.left;
    const rawY = clip.top - cr.top;
    const rawW = clip.right - clip.left;
    const rawH = clip.bottom - clip.top;
    const vw = Math.max(1, Math.floor(rawW));
    const vh = Math.max(1, Math.floor(rawH));

    const { w: contentW, h: contentH } = this.getContentSizeFromPageMetrics();
    const maxX = Math.max(0, contentW - vw);
    const maxY = Math.max(0, contentH - vh);
    const x = Math.max(0, Math.min(maxX, rawX));
    const y = Math.max(0, Math.min(maxY, rawY));

    this.viewOffset = { x, y };

    // Place the stage container at the visible "window" inside the full document container.
    // This avoids huge absolute-positioned elements inflating scroll ranges.
    this.stageContainerEl.style.left = `${x}px`;
    this.stageContainerEl.style.top = `${y}px`;
    this.stageContainerEl.style.width = `${vw}px`;
    this.stageContainerEl.style.height = `${vh}px`;

    this.stage.size({ width: vw, height: vh });

    // Camera transform: shift layers so document coords map into the viewport canvas.
    this.contentLayer.position({ x: -x, y: -y });
    this.uiLayer.position({ x: -x, y: -y });

    this.stage.batchDraw();
  }

  private getStageBox(): DOMRect | null {
    try {
      return this.stage?.container?.()?.getBoundingClientRect?.() ?? null;
    } catch {
      return null;
    }
  }

  private domRectToStageRect(r: DOMRect) {
    const sb = this.getStageBox();
    if (!sb) return null;
    return {
      x: r.left - sb.left,
      y: r.top - sb.top,
      width: r.width,
      height: r.height,
    };
  }

  private stageRectContainsDomHighlight(pos: { x: number; y: number }) {
    const sb = this.getStageBox();
    if (!sb) return null;
    const cx = sb.left + pos.x;
    const cy = sb.top + pos.y;
    // Find page quickly
    let pageNum: number | null = null;
    try {
      const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
      const pageEl = el?.closest?.(".page") as HTMLElement | null;
      if (pageEl && this.container.contains(pageEl)) {
        const n = Number(pageEl.getAttribute("data-page-number") || (pageEl as any).dataset?.pageNumber || "");
        if (Number.isFinite(n) && n > 0) pageNum = n;
      }
    } catch {
      /* ignore */
    }

    for (const [id, el] of Array.from(this.highlightDomById.entries())) {
      if (!el || !el.isConnected) continue;
      if (pageNum != null && (el.dataset?.pageNum || "") !== String(pageNum)) continue;
      const r = el.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
        const stageRect = this.domRectToStageRect(r);
        return stageRect ? { id, rect: stageRect } : { id, rect: null };
      }
    }
    return null;
  }

  // richtext editing state
  private activeTextEdit:
    | null
    | {
        pageNum: number;
        id: string;
        pageH: number;
        runs: Array<{ text: string; color: string; fontSize: number; fontWeight: "normal" | "bold"; italic?: boolean; underline?: boolean }>;
      } = null;

  // undo/redo
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  // clipboard (back-compat)
  private clipboardPayload: { version: 1; items: Array<{ type: Annotation["type"]; data: any }> } | null = null;
  private pasteCount = 0;

  constructor(
    private container: HTMLElement,
    private pdfViewer: any,
    private pdfDocument: any,
    private fileId: string,
    private userId: string
  ) {}

  private newId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random()}`;
  }

  private cleanupTextEditorDom() {
    try {
      this.textEditingInput?.remove?.();
    } catch {
      /* ignore */
    }
    this.textEditingInput = null;
    try {
      this.textEditingOverlay?.remove?.();
    } catch {
      /* ignore */
    }
    this.textEditingOverlay = null;
  }

  destroy() {
    this.destroyed = true;
    this.initSeq += 1; // invalidate any in-flight init continuation
    try {
      for (const fn of this.viewportCleanupFns.splice(0)) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    try {
      if (this.viewportSyncRaf != null) window.cancelAnimationFrame(this.viewportSyncRaf);
    } catch {
      /* ignore */
    }
    this.viewportSyncRaf = null;
    try {
      this.cleanupTextEditorDom();
    } catch {
      /* ignore */
    }
    try {
      this.highlightSelectionCleanup?.();
    } catch {
      /* ignore */
    }
    this.highlightSelectionCleanup = null;
    try {
      this.stage?.destroy();
    } catch {
      /* ignore */
    }
    this.stage = null;
    this.contentLayer = null;
    this.uiLayer = null;
    this.transformer = null;
    try {
      this.stageContainerEl?.remove();
    } catch {
      /* ignore */
    }
    this.stageContainerEl = null;
    this.pageGroups.clear();
    try {
      for (const el of this.highlightDomLayerByPage.values()) el.remove();
    } catch {
      /* ignore */
    }
    this.highlightDomLayerByPage.clear();
    this.highlightDomById.clear();
    this.pageMetrics.clear();
    this.selectedNodes = [];
  }

  async init() {
    this.destroyed = false;
    const seq = (this.initSeq += 1);
    try {
      const pos = window.getComputedStyle(this.container).position;
      if (!pos || pos === "static") this.container.style.position = "relative";
    } catch {
      if (!this.container.style.position) this.container.style.position = "relative";
    }
    // main overlay container (ABOVE textLayer): handles interaction + ink/text rendering
    const stageContainer = document.createElement("div");
    stageContainer.id = "konva-stage-container";
    stageContainer.style.position = "absolute";
    stageContainer.style.left = "0";
    stageContainer.style.top = "0";
    stageContainer.style.pointerEvents = "auto";
    stageContainer.style.zIndex = "10";
    stageContainer.style.background = "transparent";
    stageContainer.style.touchAction = "pan-x pan-y";
    this.container.appendChild(stageContainer);
    this.stageContainerEl = stageContainer;

    this.stage = new Konva.Stage({ container: stageContainer, width: 1, height: 1 });
    this.contentLayer = new Konva.Layer();
    this.uiLayer = new Konva.Layer();
    this.stage.add(this.contentLayer);
    this.stage.add(this.uiLayer);

    this.transformer = new Konva.Transformer({
      rotateEnabled: false,
      keepRatio: false,
      ignoreStroke: true,
      // Disable resizing in selection mode (bug-prone and not needed for now).
      resizeEnabled: false,
      enabledAnchors: [],
      listening: false,
    });
    this.uiLayer.add(this.transformer);

    this.bindStageEvents();

    // Keep stage in sync with scroll/resize so the canvas stays viewport-sized.
    try {
      const onViewportChange = () => this.scheduleViewportSync();
      window.addEventListener("scroll", onViewportChange, { passive: true, capture: true });
      window.addEventListener("resize", onViewportChange, { passive: true });
      const ro = new ResizeObserver(onViewportChange);
      ro.observe(this.container);
      this.viewportCleanupFns.push(() => window.removeEventListener("scroll", onViewportChange as any, true as any));
      this.viewportCleanupFns.push(() => window.removeEventListener("resize", onViewportChange as any));
      this.viewportCleanupFns.push(() => ro.disconnect());
    } catch {
      /* ignore */
    }
    this.applyViewportSync();

    // When highlight mode is active, let the browser/pdf.js perform real text selection,
    // then convert the selection rects into persistent highlights.
    try {
      this.highlightSelectionCleanup?.();
    } catch {
      /* ignore */
    }
    this.highlightSelectionCleanup = null;
    try {
      const applyHighlightsIfHighlightMode = () => {
        if (this.currentMode !== "highlight") return;
        this.applyHighlightsFromNativeSelection();
      };
      document.addEventListener("mouseup", applyHighlightsIfHighlightMode, { capture: true });
      document.addEventListener("pointerup", applyHighlightsIfHighlightMode, { capture: true });
      this.highlightSelectionCleanup = () => {
        document.removeEventListener("mouseup", applyHighlightsIfHighlightMode as any, true as any);
        document.removeEventListener("pointerup", applyHighlightsIfHighlightMode as any, true as any);
      };
    } catch {
      this.highlightSelectionCleanup = null;
    }

    const loaded = await loadAnnotations(this.fileId, this.userId);
    // If we were destroyed (or superseded by another init), bail out silently.
    if (this.destroyed || seq !== this.initSeq) return;
    this.annotations = loaded;
    this.reloadAllAnnotations();
  }

  async save() {
    await saveAnnotations(this.fileId, this.userId, this.annotations);
  }

  setMode(mode: AnnotationType) {
    const prev = this.currentMode;
    this.currentMode = mode;

    if (this.stageContainerEl) {
      // highlight mode should feel like "text selection" (I-beam)
      this.stageContainerEl.style.cursor =
        mode === "highlight" ? "text" : mode === "none" ? "default" : mode === "eraser" ? "cell" : "crosshair";
      // Touch gestures (scroll/pinch) are handled at the app layer; keep native actions disabled here.
      this.stageContainerEl.style.touchAction = "none";
      // In highlight mode, let pointer events pass through so the pdf.js text layer can receive
      // drag-to-select (PC and pad/pen). Then we apply highlights from native selection on pointerup.
      this.stageContainerEl.style.pointerEvents = mode === "highlight" ? "none" : "auto";
    }
    try {
      this.container.style.cursor = mode === "highlight" ? "text" : "";
    } catch {
      /* ignore */
    }
    // leaving freetext closes editor
    if (this.textEditingInput && mode !== "freetext") {
      this.cleanupTextEditorDom();
    }

    // reset transient states
    this.isDrawing = false;
    this.isErasing = false;
    this.isTextBoxCreating = false;
    this.textBoxStart = null;
    this.isSelectionDragging = false;
    this.selectionDragStart = null;
    this.selectionDragStartNodes = [];
    this.isMarqueeSelecting = false;
    this.marqueeStart = null;
    this.marqueeAdditive = false;
    try {
      this.marqueeRect?.destroy();
    } catch {
      /* ignore */
    }
    this.marqueeRect = null;
    try {
      this.textBoxPreview?.destroy();
    } catch {
      /* ignore */
    }
    this.textBoxPreview = null;
    try {
      this.currentDrawing?.destroy();
    } catch {
      /* ignore */
    }
    this.currentDrawing = null;
    this.currentPoints = [];

    // selection overlay handle should not remain active in other modes
    if (mode !== "none") {
      try {
        this.selectionHitRect?.destroy();
      } catch {
        /* ignore */
      }
      this.selectionHitRect = null;
      try {
        this.selectionDeleteBtn?.destroy();
      } catch {
        /* ignore */
      }
      this.selectionDeleteBtn = null;
    }

    if (prev !== mode) this.emit("modeChanged", mode);
  }

  setInkSettings(params: { color?: string; width?: number }) {
    if (typeof params.color === "string") this.inkSettings.color = params.color;
    if (typeof params.width === "number" && Number.isFinite(params.width)) this.inkSettings.width = Math.max(1, params.width);
  }

  setHighlightSettings(params: { color?: string; opacity?: number }) {
    if (typeof params.opacity === "number" && Number.isFinite(params.opacity)) this.highlightSettings.opacity = Math.min(1, Math.max(0.05, params.opacity));
    if (typeof params.color === "string") this.highlightSettings.color = params.color;
  }

  updatePagesFromPdfLayout(opts?: { padding?: number; gap?: number }) {
    const padding = typeof opts?.padding === "number" ? opts.padding : 16;
    const gap = typeof opts?.gap === "number" ? opts.gap : 14;
    const next = computePageMetricsFromPdfLayout({
      container: this.container,
      pdfViewer: this.pdfViewer,
      pdfDocument: this.pdfDocument,
      padding,
      gap,
    });
    this.pageMetrics = next;
    // reposition groups
    for (const [pageNum, m] of next.entries()) {
      const g = this.getOrCreatePageGroup(pageNum);
      g.position({ x: m.x, y: m.y });
      g.clip({ x: 0, y: 0, width: m.width, height: m.height });
    }

    // IMPORTANT: when zooming/resizing, pdf.js changes page viewport sizes.
    // We must rescale all existing Konva nodes from normalized coordinates.
    this.updateStageSize();
    this.rescaleAllPages();
    try {
      this.transformer?.forceUpdate?.();
      this.updateSelectionHitRect();
    } catch {
      /* ignore */
    }
    this.contentLayer?.batchDraw();
    this.uiLayer?.batchDraw();
    this.refreshHighlightDomAllPages();
  }

  private rescaleAllPages() {
    for (const page of this.pageMetrics.keys()) {
      this.rescalePage(page);
    }
  }

  private rescalePage(pageNum: number) {
    const m = this.pageMetrics.get(pageNum);
    const g = this.pageGroups.get(pageNum);
    if (!m || !g) return;
    const pageW = m.width || 1;
    const pageH = m.height || 1;
    const pageAnns = this.annotations[pageNum] || [];

    const isProbablyNorm = (v: any) => {
      if (!v || typeof v !== "object") return false;
      const nums: number[] = [];
      for (const k of ["x", "y", "width", "height"]) {
        if (typeof (v as any)[k] === "number") nums.push((v as any)[k]);
      }
      if (nums.length === 0) return false;
      return nums.every((n) => Number.isFinite(n) && n >= -0.5 && n <= 2.0);
    };

    for (const ann of pageAnns) {
      const data = ann.data || {};
      const v = data.v;

      // Highlight rectangles are rendered as DOM (behind textLayer), not Konva.
      if (ann.type === "highlight" && data.rectNorm) {
        this.upsertHighlightDomFromRectNorm({
          pageNum,
          id: ann.id,
          rectNorm: data.rectNorm,
          color: typeof data.color === "string" ? data.color : this.highlightSettings.color,
          opacity: typeof data.opacity === "number" ? data.opacity : this.highlightSettings.opacity,
        });
        continue;
      }

      const node = g.findOne(`#${ann.id}`) as Konva.Node | null;
      if (!node) continue;

      if (ann.type === "ink" && v === 2 && Array.isArray(data.pointsNorm) && node instanceof Konva.Line) {
        const out: number[] = [];
        for (let i = 0; i < data.pointsNorm.length; i += 2) out.push((data.pointsNorm[i] || 0) * pageW, (data.pointsNorm[i + 1] || 0) * pageH);
        node.position({ x: 0, y: 0 });
        node.points(out);
        node.strokeWidth(data.width || 2);
        node.hitStrokeWidth(Math.max(36, (data.width || 2) * 12));
        continue;
      }

      if (ann.type === "highlight" && v === 2 && data.kind === "stroke" && Array.isArray(data.pointsNorm) && node instanceof Konva.Line) {
        const out: number[] = [];
        for (let i = 0; i < data.pointsNorm.length; i += 2) out.push((data.pointsNorm[i] || 0) * pageW, (data.pointsNorm[i + 1] || 0) * pageH);
        node.position({ x: 0, y: 0 });
        node.points(out);
        node.strokeWidth(data.width || 12);
        node.hitStrokeWidth(Math.max(44, (data.width || 12) * 10));
        // Marker-like visual over text
        node.globalCompositeOperation("multiply");
        const op = typeof data.opacity === "number" ? data.opacity : this.highlightSettings.opacity;
        node.opacity(Math.min(1, Math.max(0.05, op)));
        continue;
      }

      if (ann.type === "highlight" && data.rectNorm && node instanceof Konva.Rect) {
        const norm = v === 2 || isProbablyNorm(data.rectNorm);
        const x = norm ? (data.rectNorm.x || 0) * pageW : (data.rectNorm.x || 0);
        const y = norm ? (data.rectNorm.y || 0) * pageH : (data.rectNorm.y || 0);
        const w = norm ? (data.rectNorm.width || 0) * pageW : (data.rectNorm.width || 0);
        const h = norm ? (data.rectNorm.height || 0) * pageH : (data.rectNorm.height || 0);
        node.x(x);
        node.y(y);
        node.width(w);
        node.height(h);
        if (typeof data.opacity === "number") node.opacity(Math.min(1, Math.max(0.05, data.opacity)));
        continue;
      }

      if (ann.type === "freetext" && v === 2 && data.kind === "textbox" && node instanceof Konva.Group) {
        const x = (data.xNorm || 0) * pageW;
        const y = (data.yNorm || 0) * pageH;
        const w = Math.max(120, (data.widthNorm || 0.2) * pageW);
        const h = Math.max(60, (data.heightNorm || 0.1) * pageH);
        const pad = typeof data.padding === "number" ? data.padding : 8;
        node.position({ x, y });
        const rect = node.findOne(".textbox-rect") as Konva.Rect | null;
        if (rect) {
          rect.width(w);
          rect.height(h);
        }
        // Re-render rich text runs with new pageH -> px conversion.
        this.renderTextboxRuns({ box: node, pageNum, pageW, pageH, data, w, h, pad });
        continue;
      }

      // Plain freetext legacy
      if (ann.type === "freetext" && v === 2 && node instanceof Konva.Text && data.kind !== "textbox") {
        node.x((data.xNorm || 0) * pageW);
        node.y((data.yNorm || 0) * pageH);
        if (typeof data.fontSizeNorm === "number") node.fontSize(Math.max(10, data.fontSizeNorm * pageH));
        continue;
      }
    }
  }

  updateStageSize() {
    // Legacy name retained: this now keeps the stage *viewport-sized*.
    // Callers still invoke this after zoom/layout updates.
    this.applyViewportSync();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(entry);
    this.restoreSnapshot(entry.before);
    this.reloadAllAnnotations();
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(entry);
    this.restoreSnapshot(entry.after);
    this.reloadAllAnnotations();
  }

  deleteSelected() {
    if (this.selectedNodes.length === 0) return;
    const ids = new Set(this.selectedNodes.map((n) => n.id()).filter(Boolean));
    const pages = new Set<number>();
    for (const [p, list] of Object.entries(this.annotations)) {
      const page = Number(p);
      if (!Number.isFinite(page)) continue;
      if ((list || []).some((a) => ids.has(a.id))) pages.add(page);
    }
    this.recordUndo(Array.from(pages), () => {
      for (const [p, list] of Object.entries(this.annotations)) {
        const page = Number(p);
        if (!Number.isFinite(page)) continue;
        this.annotations[page] = (list || []).filter((a) => !ids.has(a.id));
      }
      for (const n of this.selectedNodes) {
        try {
          n.destroy();
        } catch {
          /* ignore */
        }
      }
      // Also remove DOM-based highlights.
      for (const id of Array.from(ids)) {
        this.removeHighlightDomById(id);
      }
      this.clearSelection();
    });
    this.contentLayer?.batchDraw();
    this.uiLayer?.batchDraw();
    this.refreshHighlightDomAllPages();
  }

  // Back-compat clipboard APIs (used by `pdfjs-viewer/toolbar/clipboard.ts`)
  copySelectedToClipboard() {
    if (this.selectedNodes.length === 0) return;
    const ids = new Set(this.selectedNodes.map((n) => n.id()).filter(Boolean));
    const items: Array<{ type: Annotation["type"]; data: any }> = [];
    for (const list of Object.values(this.annotations)) {
      for (const ann of list || []) {
        if (!ids.has(ann.id)) continue;
        items.push({ type: ann.type, data: JSON.parse(JSON.stringify(ann.data || {})) });
      }
    }
    this.clipboardPayload = items.length ? { version: 1, items } : null;
    this.pasteCount = 0;
  }

  cutSelectedToClipboard() {
    this.copySelectedToClipboard();
    this.deleteSelected();
  }

  async pasteFromClipboard(targetPage: number) {
    if (!this.clipboardPayload || this.clipboardPayload.version !== 1) return;
    const m = this.pageMetrics.get(targetPage);
    if (!m) return;
    const pageW = m.width || 1;
    const pageH = m.height || 1;
    const dx = 0.01 * (this.pasteCount + 1);
    const dy = 0.01 * (this.pasteCount + 1);
    this.pasteCount += 1;

    const newSelected: Konva.Node[] = [];
    const g = this.getOrCreatePageGroup(targetPage);

    this.recordUndo([targetPage], () => {
      if (!this.annotations[targetPage]) this.annotations[targetPage] = [];
      for (const it of this.clipboardPayload!.items) {
        const id = this.newId("paste");
        const data = JSON.parse(JSON.stringify(it.data || {}));
        // best-effort normalize offsets for v2 shapes
        if (data?.v === 2) {
          if (typeof data.xNorm === "number") data.xNorm = Math.min(0.98, Math.max(0, data.xNorm + dx));
          if (typeof data.yNorm === "number") data.yNorm = Math.min(0.98, Math.max(0, data.yNorm + dy));
          if (data.kind === "textbox") {
            // keep in bounds
            if (typeof data.widthNorm === "number") data.widthNorm = Math.min(0.95, Math.max(0.05, data.widthNorm));
            if (typeof data.heightNorm === "number") data.heightNorm = Math.min(0.95, Math.max(0.05, data.heightNorm));
          }
          if (Array.isArray(data.pointsNorm)) {
            const out: number[] = [];
            for (let i = 0; i < data.pointsNorm.length; i += 2) {
              out.push(Math.min(0.98, Math.max(0, (data.pointsNorm[i] || 0) + dx)));
              out.push(Math.min(0.98, Math.max(0, (data.pointsNorm[i + 1] || 0) + dy)));
            }
            data.pointsNorm = out;
          }
          if (data.rectNorm) {
            data.rectNorm = {
              ...data.rectNorm,
              x: Math.min(0.98, Math.max(0, (data.rectNorm.x || 0) + dx)),
              y: Math.min(0.98, Math.max(0, (data.rectNorm.y || 0) + dy)),
            };
          }
        }

        const ann: Annotation = {
          id,
          type: it.type,
          page: targetPage,
          data,
          created_at: new Date().toISOString(),
        };
        this.annotations[targetPage].push(ann);
        this.loadAnnotationToGroup(ann, g, targetPage);
        const node = g.findOne(`#${id}`) as Konva.Node | null;
        if (node) newSelected.push(node);
      }
    });

    this.contentLayer?.batchDraw();
    if (newSelected.length) this.setSelection(newSelected);
  }

  // -----------------
  // internal helpers
  // -----------------
  private clonePageValue(v: Annotation[] | undefined): Annotation[] | null {
    if (!v) return null;
    return JSON.parse(JSON.stringify(v));
  }

  private snapshotPages(pages: number[]): PageSnapshot {
    const out: PageSnapshot = {};
    pages.forEach((p) => {
      out[p] = this.clonePageValue(this.annotations[p]);
    });
    return out;
  }

  private restoreSnapshot(snapshot: PageSnapshot) {
    for (const [k, v] of Object.entries(snapshot)) {
      const p = Number(k);
      if (!Number.isFinite(p)) continue;
      if (v === null) {
        delete this.annotations[p];
      } else {
        this.annotations[p] = JSON.parse(JSON.stringify(v));
      }
    }
  }

  private recordUndo(pages: number[], fn: () => void) {
    const uniqPages = Array.from(new Set(pages.filter((p) => Number.isFinite(p) && p > 0)));
    const before = this.snapshotPages(uniqPages);
    fn();
    const after = this.snapshotPages(uniqPages);
    this.undoStack.push({ pages: uniqPages, before, after });
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  private getOrCreatePageGroup(pageNum: number): Konva.Group {
    const existing = this.pageGroups.get(pageNum);
    if (existing) return existing;
    // If contentLayer is missing (destroyed / not yet initialized), avoid throwing.
    // Returning a detached group is safer than crashing; callers should generally be
    // guarded by lifecycle checks, but this is a last-resort safety net.
    if (!this.contentLayer) return new Konva.Group({ id: `page-${pageNum}` });
    const g = new Konva.Group({ id: `page-${pageNum}` });
    this.contentLayer.add(g);
    this.pageGroups.set(pageNum, g);
    return g;
  }

  private clearSelection() {
    try {
      this.transformer?.detach();
    } catch {
      /* ignore */
    }
    // Clean up UI-only highlight outline nodes (used for selecting DOM highlights).
    try {
      for (const n of this.selectedNodes) {
        if (!n) continue;
        if (typeof (n as any).hasName === "function" && (n as any).hasName("hl-outline")) {
          try {
            n.destroy();
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
    this.selectedNodes = [];
    try {
      this.selectionHitRect?.destroy();
    } catch {
      /* ignore */
    }
    this.selectionHitRect = null;
    try {
      this.selectionDeleteBtn?.destroy();
    } catch {
      /* ignore */
    }
    this.selectionDeleteBtn = null;
    this.uiLayer?.batchDraw();
  }

  private updateSelectionHitRect() {
    if (!this.uiLayer) return;
    if (this.currentMode !== "none") return;
    if (!this.selectedNodes.length) {
      try {
        this.selectionHitRect?.destroy();
      } catch {
        /* ignore */
      }
      this.selectionHitRect = null;
      try {
        this.selectionDeleteBtn?.destroy();
      } catch {
        /* ignore */
      }
      this.selectionDeleteBtn = null;
      return;
    }
    // Union bbox in document coords so the hit rect matches cursor regardless of scroll.
    // getClientRect(relativeTo: stage) gives stage coords; add viewOffset to get document coords.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const n of this.selectedNodes) {
      try {
        let docX: number;
        let docY: number;
        let r: { x: number; y: number; width: number; height: number };
        if (this.stage) {
          r = n.getClientRect({ relativeTo: this.stage, skipTransform: false });
          docX = r.x + this.viewOffset.x;
          docY = r.y + this.viewOffset.y;
        } else {
          r = n.getClientRect({ skipTransform: false });
          docX = r.x;
          docY = r.y;
        }
        if (!Number.isFinite(docX) || !Number.isFinite(docY) || !Number.isFinite(r.width) || !Number.isFinite(r.height)) continue;
        minX = Math.min(minX, docX);
        minY = Math.min(minY, docY);
        maxX = Math.max(maxX, docX + r.width);
        maxY = Math.max(maxY, docY + r.height);
      } catch {
        /* ignore */
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return;
    const pad = 8;
    const x = minX - pad;
    const y = minY - pad;
    const w = Math.max(1, maxX - minX + pad * 2);
    const h = Math.max(1, maxY - minY + pad * 2);

    if (!this.selectionHitRect) {
      this.selectionHitRect = new Konva.Rect({
        x,
        y,
        width: w,
        height: h,
        name: "selection-hit-rect",
        fill: "rgba(0,0,0,0.001)", // invisible but hittable
        listening: true,
        draggable: false,
      });
      this.selectionHitRect.on("pointerdown", (evt: Konva.KonvaEventObject<PointerEvent>) => {
        if (this.currentMode !== "none") return;
        if (getPointerKind((evt as any)?.evt) === "touch") return;
        if (!this.stage) return;
        const pos = this.stage.getPointerPosition();
        if (!pos) return;
        try {
          evt.cancelBubble = true;
          // IMPORTANT: Do NOT call native preventDefault/stopPropagation here.
          // It can break browser/Konva dblclick recognition for underlying objects.
        } catch {
          /* ignore */
        }
        this.isSelectionDragging = true;
        // Store in document coords so drag follows cursor regardless of scroll
        this.selectionDragStart = this.stageToDoc(pos);
        this.selectionDragStartNodes = (this.selectedNodes || []).map((n) => {
          const p = n.getParent();
          return { node: n, docX: (p ? p.x() : 0) + n.x(), docY: (p ? p.y() : 0) + n.y() };
        });
      });
      // keep behind transformer anchors
      this.uiLayer.add(this.selectionHitRect);
    } else {
      this.selectionHitRect.position({ x, y });
      this.selectionHitRect.size({ width: w, height: h });
    }

    // Selection delete button (for tablets: tap to delete without keyboard)
    const BTN = 18;
    const margin = 2;
    const bx = x + w - BTN - margin;
    const by = y + margin;
    if (!this.selectionDeleteBtn) {
      const g = new Konva.Group({ x: bx, y: by, name: "selection-delete-btn", listening: true });
      const bg = new Konva.Circle({
        x: BTN / 2,
        y: BTN / 2,
        radius: BTN / 2,
        fill: "rgba(239,68,68,0.95)",
        stroke: "rgba(255,255,255,0.9)",
        strokeWidth: 1,
        listening: true,
      });
      const label = new Konva.Text({
        x: 0,
        y: 1,
        width: BTN,
        height: BTN,
        text: "×",
        fontSize: 14,
        fontStyle: "bold",
        align: "center",
        fill: "#ffffff",
        listening: false,
      });
      g.add(bg);
      g.add(label);
      g.on("pointerdown", (evt: any) => {
        try {
          evt.cancelBubble = true;
          evt.evt?.preventDefault?.();
        } catch {
          /* ignore */
        }
        this.deleteSelected();
      });
      this.selectionDeleteBtn = g;
      this.uiLayer.add(g);
    } else {
      this.selectionDeleteBtn.position({ x: bx, y: by });
    }

    // Ensure correct z-order (hit rect behind, transformer border above, delete button on top)
    try {
      this.transformer?.moveToTop();
    } catch {
      /* ignore */
    }
    try {
      this.selectionDeleteBtn?.moveToTop();
    } catch {
      /* ignore */
    }
  }

  private setSelection(nodes: Konva.Node[]) {
    // If we are replacing selection, remove any previous UI-only highlight outlines that are not reused.
    try {
      const keep = new Set(nodes.map((n) => n?.id?.()).filter(Boolean));
      for (const n of this.selectedNodes) {
        const id = n?.id?.();
        if (!id) continue;
        if (keep.has(id)) continue;
        if (typeof (n as any).hasName === "function" && (n as any).hasName("hl-outline")) {
          try {
            n.destroy();
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
    this.selectedNodes = nodes;
    if (!this.transformer) return;
    try {
      this.transformer.nodes(nodes);
    } catch {
      /* ignore */
    }
    try {
      this.updateSelectionHitRect();
    } catch {
      /* ignore */
    }
    this.uiLayer?.batchDraw();
  }

  private getPageForNode(node: Konva.Node): number | null {
    let cur: Konva.Node | null = node;
    while (cur) {
      const id = cur.id?.();
      if (id && id.startsWith("page-")) {
        const n = Number(id.slice("page-".length));
        return Number.isFinite(n) ? n : null;
      }
      cur = cur.getParent?.() as any;
    }
    return null;
  }

  private resolveAnnotationNode(node: Konva.Node): Konva.Node | null {
    // For textbox richtext segments, the real annotation node is the enclosing group id.
    let cur: Konva.Node | null = node;
    while (cur) {
      const id = cur.id?.();
      if (id && !id.startsWith("page-")) return cur;
      cur = cur.getParent?.() as any;
    }
    const ownId = node.id?.();
    if (ownId && ownId.startsWith("page-")) return null;
    return node;
  }

  private getSelectableNodes(): Konva.Node[] {
    const out: Konva.Node[] = [];
    for (const g of this.pageGroups.values()) {
      for (const n of g.getChildren()) {
        try {
          const id = n.id?.();
          if (!id) continue;
          if (id.startsWith("page-")) continue;
          out.push(n);
        } catch {
          /* ignore */
        }
      }
    }
    return out;
  }

  private boxesIntersect(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ) {
    const ax2 = a.x + a.width;
    const ay2 = a.y + a.height;
    const bx2 = b.x + b.width;
    const by2 = b.y + b.height;
    return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
  }

  private mergeHighlightRects(rects: Array<{ x: number; y: number; width: number; height: number }>) {
    if (rects.length <= 1) return rects;

    // Group by approximate line-center to merge word boxes into line boxes.
    const keyFor = (r: { x: number; y: number; width: number; height: number }) => Math.round((r.y + r.height / 2) / 8);
    const byLine = new Map<number, Array<{ x: number; y: number; width: number; height: number }>>();
    for (const r of rects) {
      const k = keyFor(r);
      const list = byLine.get(k) ?? [];
      list.push(r);
      byLine.set(k, list);
    }

    const merged: Array<{ x: number; y: number; width: number; height: number }> = [];
    const gapTol = 4; // px
    const overlapTol = 0.35; // vertical overlap ratio

    const overlapRatio = (a: any, b: any) => {
      const top = Math.max(a.y, b.y);
      const bot = Math.min(a.y + a.height, b.y + b.height);
      const inter = Math.max(0, bot - top);
      const denom = Math.max(1, Math.min(a.height, b.height));
      return inter / denom;
    };

    for (const [, items] of byLine.entries()) {
      items.sort((p, q) => (p.x - q.x) || (p.y - q.y));
      let cur: { x: number; y: number; width: number; height: number } | null = null;
      for (const r of items) {
        if (!cur) {
          cur = { ...r };
          continue;
        }
        const curRight = cur.x + cur.width;
        const rRight = r.x + r.width;
        const closeEnough = r.x <= curRight + gapTol;
        const vOverlapOk = overlapRatio(cur, r) >= overlapTol;
        if (closeEnough && vOverlapOk) {
          const nx = Math.min(cur.x, r.x);
          const ny = Math.min(cur.y, r.y);
          const nr = Math.max(curRight, rRight);
          const nb = Math.max(cur.y + cur.height, r.y + r.height);
          cur = { x: nx, y: ny, width: nr - nx, height: nb - ny };
        } else {
          merged.push(cur);
          cur = { ...r };
        }
      }
      if (cur) merged.push(cur);
    }

    // Keep output stable: top-to-bottom then left-to-right
    merged.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return merged;
  }

  private findPageElementForClientRect(r: DOMRect): HTMLElement | null {
    try {
      const cx = r.left + Math.max(1, Math.min(r.width - 1, r.width / 2));
      const cy = r.top + Math.max(1, Math.min(r.height - 1, r.height / 2));
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
        const page = el?.closest?.(".page") as HTMLElement | null;
        if (page && this.container.contains(page)) return page;
      }
    } catch {
      /* ignore */
    }

    // Fallback: brute-force match by intersecting bounding boxes.
    try {
      const pages = Array.from(this.container.querySelectorAll(".page")) as HTMLElement[];
      let best: { el: HTMLElement; area: number } | null = null;
      for (const p of pages) {
        const pr = p.getBoundingClientRect();
        const ix = Math.max(0, Math.min(r.right, pr.right) - Math.max(r.left, pr.left));
        const iy = Math.max(0, Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top));
        const area = ix * iy;
        if (area <= 0) continue;
        if (!best || area > best.area) best = { el: p, area };
      }
      return best?.el ?? null;
    } catch {
      return null;
    }
  }

  private ensureHighlightDomLayer(pageNum: number): HTMLDivElement | null {
    try {
      const existing = this.highlightDomLayerByPage.get(pageNum);
      if (existing && existing.isConnected) return existing;
    } catch {
      /* ignore */
    }
    try {
      const pageEl = this.container.querySelector(`.page[data-page-number="${pageNum}"]`) as HTMLElement | null;
      if (!pageEl) return null;
      // Create a dedicated layer that sits UNDER the pdf.js textLayer.
      const layer = document.createElement("div");
      layer.className = "divera-highlight-layer";
      layer.style.position = "absolute";
      layer.style.left = "0";
      layer.style.top = "0";
      layer.style.width = "100%";
      layer.style.height = "100%";
      layer.style.pointerEvents = "none";
      // Force behind textLayer regardless of pdf.js defaults.
      layer.style.zIndex = "0";
      layer.style.mixBlendMode = "multiply";
      // Make sure the page itself is a positioning context.
      try {
        const pos = window.getComputedStyle(pageEl).position;
        if (!pos || pos === "static") pageEl.style.position = "relative";
      } catch {
        /* ignore */
      }

      const textLayer = pageEl.querySelector(".textLayer") as HTMLElement | null;
      if (textLayer && textLayer.parentElement === pageEl) {
        pageEl.insertBefore(layer, textLayer);
        // Ensure text is always above.
        try {
          (textLayer.style as any).zIndex = "2";
        } catch {
          /* ignore */
        }
      } else {
        pageEl.appendChild(layer);
      }
      this.highlightDomLayerByPage.set(pageNum, layer);
      return layer;
    } catch {
      return null;
    }
  }

  private removeHighlightDomById(id: string) {
    try {
      const el = this.highlightDomById.get(id);
      if (el) el.remove();
    } catch {
      /* ignore */
    }
    this.highlightDomById.delete(id);
  }

  private upsertHighlightDomFromRectNorm(params: {
    pageNum: number;
    id: string;
    rectNorm: any;
    color: string;
    opacity: number;
  }) {
    const { pageNum, id, rectNorm, color, opacity } = params;
    const layer = this.ensureHighlightDomLayer(pageNum);
    if (!layer) return;
    const pageEl = this.container.querySelector(`.page[data-page-number="${pageNum}"]`) as HTMLElement | null;
    if (!pageEl) return;
    // IMPORTANT:
    // Absolutely positioned children are positioned relative to the *padding edge* of the page element,
    // not the border-box. So we must use clientWidth/clientHeight and clientLeft/clientTop for alignment.
    const pageW = Math.max(1, Number(pageEl.clientWidth || 1) || 1);
    const pageH = Math.max(1, Number(pageEl.clientHeight || 1) || 1);

    const rn = rectNorm || {};
    // Our highlight rects are stored as normalized (v=2).
    let x = Number(rn.x || 0) * pageW;
    let y = Number(rn.y || 0) * pageH;
    let w = Number(rn.width || 0) * pageW;
    let h = Number(rn.height || 0) * pageH;

    // Clamp to page
    x = Math.max(0, Math.min(pageW, x));
    y = Math.max(0, Math.min(pageH, y));
    w = Math.max(0, Math.min(pageW - x, w));
    h = Math.max(0, Math.min(pageH - y, h));
    if (w <= 0 || h <= 0) return;

    let el = this.highlightDomById.get(id);
    if (!el || !el.isConnected) {
      el = document.createElement("div");
      el.dataset.annId = id;
      el.dataset.pageNum = String(pageNum);
      el.style.position = "absolute";
      el.style.pointerEvents = "none";
      // Slight rounding looks nicer for highlighter blocks.
      el.style.borderRadius = "2px";
      layer.appendChild(el);
      this.highlightDomById.set(id, el);
    } else if (el.parentElement !== layer) {
      try {
        layer.appendChild(el);
      } catch {
        /* ignore */
      }
    }

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.background = color;
    el.style.opacity = `${Math.min(1, Math.max(0.05, Number(opacity) || 0.35))}`;
  }

  private upsertHighlightDomFromRectsNorm(params: {
    pageNum: number;
    id: string;
    rectsNorm: any[];
    color: string;
    opacity: number;
  }) {
    const { pageNum, id, rectsNorm, color, opacity } = params;
    const layer = this.ensureHighlightDomLayer(pageNum);
    if (!layer) return;
    const pageEl = this.container.querySelector(`.page[data-page-number="${pageNum}"]`) as HTMLElement | null;
    if (!pageEl) return;
    const pageW = Math.max(1, Number(pageEl.clientWidth || 1) || 1);
    const pageH = Math.max(1, Number(pageEl.clientHeight || 1) || 1);
    const list = Array.isArray(rectsNorm) ? rectsNorm : [];
    if (list.length === 0) return;

    // Convert to px + compute union box
    const rectsPx: Array<{ x: number; y: number; width: number; height: number }> = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const rn of list) {
      if (!rn || typeof rn !== "object") continue;
      let x = Number(rn.x || 0) * pageW;
      let y = Number(rn.y || 0) * pageH;
      let w = Number(rn.width || 0) * pageW;
      let h = Number(rn.height || 0) * pageH;
      x = Math.max(0, Math.min(pageW, x));
      y = Math.max(0, Math.min(pageH, y));
      w = Math.max(0, Math.min(pageW - x, w));
      h = Math.max(0, Math.min(pageH - y, h));
      if (w <= 0 || h <= 0) continue;
      rectsPx.push({ x, y, width: w, height: h });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
    if (rectsPx.length === 0) return;
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return;

    let wrapper = this.highlightDomById.get(id);
    if (!wrapper || !wrapper.isConnected) {
      wrapper = document.createElement("div");
      wrapper.dataset.annId = id;
      wrapper.dataset.pageNum = String(pageNum);
      wrapper.style.position = "absolute";
      wrapper.style.pointerEvents = "none";
      layer.appendChild(wrapper);
      this.highlightDomById.set(id, wrapper);
    } else if (wrapper.parentElement !== layer) {
      try {
        layer.appendChild(wrapper);
      } catch {
        /* ignore */
      }
    }

    // Union box defines the wrapper bounds (for selection/hit-testing).
    const ux = Math.max(0, Math.min(pageW, minX));
    const uy = Math.max(0, Math.min(pageH, minY));
    const uw = Math.max(1, Math.min(pageW - ux, maxX - minX));
    const uh = Math.max(1, Math.min(pageH - uy, maxY - minY));
    wrapper.style.left = `${ux}px`;
    wrapper.style.top = `${uy}px`;
    wrapper.style.width = `${uw}px`;
    wrapper.style.height = `${uh}px`;

    // Rebuild children
    try {
      while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
    } catch {
      /* ignore */
    }
    const a = Math.min(1, Math.max(0.05, Number(opacity) || 0.35));
    for (const r of rectsPx) {
      const seg = document.createElement("div");
      seg.style.position = "absolute";
      seg.style.left = `${r.x - ux}px`;
      seg.style.top = `${r.y - uy}px`;
      seg.style.width = `${r.width}px`;
      seg.style.height = `${r.height}px`;
      seg.style.background = color;
      seg.style.opacity = `${a}`;
      seg.style.borderRadius = "2px";
      wrapper.appendChild(seg);
    }
  }

  private refreshHighlightDomForPage(pageNum: number) {
    const layer = this.ensureHighlightDomLayer(pageNum);
    if (!layer) return;
    const list = this.annotations[pageNum] || [];
    const keep = new Set<string>();
    for (const ann of list) {
      if (!ann || ann.type !== "highlight") continue;
      const d = ann.data || {};
      keep.add(ann.id);
      if (Array.isArray(d.rectsNorm) && d.rectsNorm.length) {
        this.upsertHighlightDomFromRectsNorm({
          pageNum,
          id: ann.id,
          rectsNorm: d.rectsNorm,
          color: typeof d.color === "string" ? d.color : this.highlightSettings.color,
          opacity: typeof d.opacity === "number" ? d.opacity : this.highlightSettings.opacity,
        });
      } else if (d.rectNorm) {
        this.upsertHighlightDomFromRectNorm({
          pageNum,
          id: ann.id,
          rectNorm: d.rectNorm,
          color: typeof d.color === "string" ? d.color : this.highlightSettings.color,
          opacity: typeof d.opacity === "number" ? d.opacity : this.highlightSettings.opacity,
        });
      } else {
        // no rect => skip
        keep.delete(ann.id);
      }
    }

    // Remove stale DOM nodes for this page
    for (const [id, el] of Array.from(this.highlightDomById.entries())) {
      if ((el?.dataset?.pageNum || "") !== String(pageNum)) continue;
      if (keep.has(id)) continue;
      this.removeHighlightDomById(id);
    }
  }

  private refreshHighlightDomAllPages() {
    for (const pageNum of this.pageMetrics.keys()) {
      this.refreshHighlightDomForPage(pageNum);
    }
  }

  private applyHighlightsFromNativeSelection() {
    try {
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount <= 0) return;
      if (sel.isCollapsed) return;

      const range = sel.getRangeAt(0);
      const common = range.commonAncestorContainer;
      const commonEl =
        (common && (common as any).nodeType === 1 ? (common as any as HTMLElement) : (common as any)?.parentElement) || null;
      if (!commonEl || !this.container.contains(commonEl)) return;

      const clientRects = Array.from(range.getClientRects?.() || []);
      if (!clientRects.length) return;

      const perPage = new Map<number, Array<{ x: number; y: number; width: number; height: number }>>();

      // Use the actual selection rects so partial-word selections work.
      // (Span-based highlighting will often expand to the whole word/span.)
      for (const rr of clientRects) {
        const w = Number((rr as any).width || 0);
        const h = Number((rr as any).height || 0);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0.5 || h < 0.5) continue;

        const pageEl = this.findPageElementForClientRect(rr as any);
        if (!pageEl) continue;
        const pageNum = Number(pageEl.getAttribute("data-page-number") || (pageEl as any).dataset?.pageNumber || "");
        if (!Number.isFinite(pageNum) || pageNum <= 0) continue;

        const pageW = Math.max(1, Number((pageEl as any).clientWidth || 1) || 1);
        const pageH = Math.max(1, Number((pageEl as any).clientHeight || 1) || 1);
        const pageBox = pageEl.getBoundingClientRect();
        const baseLeft = pageBox.left + ((pageEl as any).clientLeft || 0);
        const baseTop = pageBox.top + ((pageEl as any).clientTop || 0);

        // Try to align height to the nearest text span (visual consistency),
        // but keep horizontal bounds from the actual selection rect.
        let yTop = (rr as any).top;
        let yH = h;
        try {
          const cx = (rr as any).left + w / 2;
          const cy = (rr as any).top + h / 2;
          const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
          const span = el?.closest?.(".textLayer span") as HTMLElement | null;
          if (span) {
            const sr = span.getBoundingClientRect();
            if (sr && sr.height > 0.5) {
              yTop = sr.top;
              yH = sr.height;
            }
          }
        } catch {
          /* ignore */
        }

        let x = (rr as any).left - baseLeft;
        let y = yTop - baseTop;
        let width = w;
        let height = yH;

        const padX = Math.min(2, width * 0.06);
        const padY = Math.min(1.2, height * 0.08);
        x -= padX;
        y -= padY;
        width += padX * 2;
        height += padY * 2;

        x = Math.max(0, Math.min(pageW, x));
        y = Math.max(0, Math.min(pageH, y));
        width = Math.max(0, Math.min(pageW - x, width));
        height = Math.max(0, Math.min(pageH - y, height));
        if (width <= 0 || height <= 0) continue;

        const list = perPage.get(pageNum) ?? [];
        list.push({ x, y, width, height });
        perPage.set(pageNum, list);
      }

      if (perPage.size === 0) return;

      // Clear selection UI immediately (so user sees our highlight, not browser selection).
      try {
        sel.removeAllRanges();
      } catch {
        /* ignore */
      }

      const pages = Array.from(perPage.keys()).sort((a, b) => a - b);
      const createdByPage = new Map<number, Annotation[]>();
      for (const pageNum of pages) {
        const metrics = this.pageMetrics.get(pageNum);
        if (!metrics) continue;
        const pageEl = this.container.querySelector(`.page[data-page-number="${pageNum}"]`) as HTMLElement | null;
        if (!pageEl) continue;
        const pageW = Math.max(1, Number(pageEl.clientWidth || 1) || 1);
        const pageH = Math.max(1, Number(pageEl.clientHeight || 1) || 1);
        const merged = this.mergeHighlightRects(perPage.get(pageNum) || []);
        if (!merged.length) continue;
        const capped = merged.slice(0, 400); // safety cap (segments per page)

        // ✅ One drag => one highlight annotation (per page), with multiple segments.
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        const rectsNorm: Array<{ x: number; y: number; width: number; height: number }> = [];
        for (const r of capped) {
          minX = Math.min(minX, r.x);
          minY = Math.min(minY, r.y);
          maxX = Math.max(maxX, r.x + r.width);
          maxY = Math.max(maxY, r.y + r.height);
          rectsNorm.push({
            x: r.x / pageW,
            y: r.y / pageH,
            width: r.width / pageW,
            height: r.height / pageH,
          });
        }
        if (!rectsNorm.length) continue;
        const id = this.newId("highlight");
        const ann: Annotation = {
          id,
          type: "highlight",
          page: pageNum,
          data: {
            v: 2,
            kind: "multi",
            // union (for helper fields/back-compat)
            rectNorm: {
              x: Math.max(0, minX / pageW),
              y: Math.max(0, minY / pageH),
              width: Math.max(0, (maxX - minX) / pageW),
              height: Math.max(0, (maxY - minY) / pageH),
            },
            rectsNorm,
            color: this.highlightSettings.color,
            opacity: this.highlightSettings.opacity,
          },
          created_at: new Date().toISOString(),
        };
        createdByPage.set(pageNum, [ann]);
      }
      if (createdByPage.size === 0) return;

      this.recordUndo(Array.from(createdByPage.keys()), () => {
        for (const [pageNum, anns] of createdByPage.entries()) {
          if (!this.annotations[pageNum]) this.annotations[pageNum] = [];
          this.annotations[pageNum].push(...anns);
        }
      });
      for (const [pageNum, anns] of createdByPage.entries()) {
        const g = this.getOrCreatePageGroup(pageNum);
        for (const ann of anns) this.loadAnnotationToGroup(ann, g, pageNum);
      }

      this.contentLayer?.batchDraw();
      this.uiLayer?.batchDraw();
    } catch {
      /* ignore */
    }
  }

  private collectTextLayerHighlightRects(params: {
    pageNum: number;
    selection: { x: number; y: number; width: number; height: number };
    pageW: number;
    pageH: number;
  }): Array<{ x: number; y: number; width: number; height: number }> {
    const { pageNum, selection, pageW, pageH } = params;
    try {
      const pageEl = this.container.querySelector(`.page[data-page-number="${pageNum}"]`) as HTMLElement | null;
      if (!pageEl) return [];
      const textLayer = pageEl.querySelector(".textLayer") as HTMLElement | null;
      if (!textLayer) return [];

      const pageBox = pageEl.getBoundingClientRect();
      const spans = Array.from(textLayer.querySelectorAll("span")) as HTMLElement[];
      const raw: Array<{ x: number; y: number; width: number; height: number }> = [];

      for (const span of spans) {
        const t = (span.textContent || "").trim();
        if (!t) continue;
        const r = span.getBoundingClientRect();
        if (!Number.isFinite(r.width) || !Number.isFinite(r.height) || r.width < 0.5 || r.height < 0.5) continue;
        const x = r.left - pageBox.left;
        const y = r.top - pageBox.top;
        const w = r.width;
        const h = r.height;
        if (!this.boxesIntersect(selection, { x, y, width: w, height: h })) continue;

        // Slight padding looks more like a real highlighter stroke.
        const padX = Math.min(2, w * 0.08);
        const padY = Math.min(1.5, h * 0.12);
        let hx = x - padX;
        let hy = y - padY;
        let hw = w + padX * 2;
        let hh = h + padY * 2;

        // Clamp to page bounds (page-local coords)
        hx = Math.max(0, Math.min(pageW, hx));
        hy = Math.max(0, Math.min(pageH, hy));
        hw = Math.max(0, Math.min(pageW - hx, hw));
        hh = Math.max(0, Math.min(pageH - hy, hh));
        if (hw <= 0 || hh <= 0) continue;

        raw.push({ x: hx, y: hy, width: hw, height: hh });
      }

      // Limit worst-case explosion (e.g. per-character spans on scanned PDFs).
      if (raw.length > 1200) {
        raw.length = 1200;
      }

      return this.mergeHighlightRects(raw);
    } catch {
      return [];
    }
  }

  private reloadAllAnnotations() {
    if (this.destroyed) return;
    if (!this.contentLayer) return;
    for (const g of this.pageGroups.values()) {
      try {
        g.destroyChildren();
      } catch {
        /* ignore */
      }
    }
    for (const [pageStr, list] of Object.entries(this.annotations)) {
      const pageNum = Number(pageStr);
      if (!Number.isFinite(pageNum)) continue;
      const g = this.getOrCreatePageGroup(pageNum);
      for (const ann of list || []) {
        this.loadAnnotationToGroup(ann, g, pageNum);
      }
    }
    this.contentLayer?.batchDraw();
    this.refreshHighlightDomAllPages();
  }

  private loadAnnotationToGroup(ann: Annotation, group: Konva.Group, pageNum: number) {
    const metrics = this.pageMetrics.get(pageNum);
    const pageW = metrics?.width || 1;
    const pageH = metrics?.height || 1;
    const v = ann.data?.v;
    const data = ann.data || {};

    if (ann.type === "ink" && (data.points || (v === 2 && Array.isArray(data.pointsNorm)))) {
      const points: number[] = (() => {
        if (v === 2 && Array.isArray(data.pointsNorm)) {
          const out: number[] = [];
          for (let i = 0; i < data.pointsNorm.length; i += 2) out.push((data.pointsNorm[i] || 0) * pageW, (data.pointsNorm[i + 1] || 0) * pageH);
          return out;
        }
        return data.points;
      })();
      const line = new Konva.Line({
        points,
        stroke: data.color || "#111827",
        strokeWidth: data.width || 2,
        lineCap: "round",
        lineJoin: "round",
        tension: 0.35,
        perfectDrawEnabled: false,
        shadowForStrokeEnabled: false,
        hitStrokeWidth: Math.max(36, (data.width || 2) * 12),
        id: ann.id,
        draggable: true,
        listening: true,
      });
      line.on("dragend._persist", () => {
        const offX = line.x();
        const offY = line.y();
        if (Math.abs(offX) < 0.5 && Math.abs(offY) < 0.5) return;
        const metrics = this.pageMetrics.get(pageNum);
        const pageW2 = metrics?.width || 1;
        const pageH2 = metrics?.height || 1;
        const dxNorm = offX / pageW2;
        const dyNorm = offY / pageH2;
        this.recordUndo([pageNum], () => {
          const list = this.annotations[pageNum] || [];
          const target = list.find((a) => a.id === ann.id);
          if (!target) return;
          const d = target.data || {};
          if (d.v !== 2 || !Array.isArray(d.pointsNorm)) return;
          const out: number[] = [];
          for (let i = 0; i < d.pointsNorm.length; i += 2) {
            out.push(Math.min(0.98, Math.max(0, (d.pointsNorm[i] || 0) + dxNorm)));
            out.push(Math.min(0.98, Math.max(0, (d.pointsNorm[i + 1] || 0) + dyNorm)));
          }
          target.data = { ...(target.data || {}), pointsNorm: out };
        });
        try {
          const pts = line.points();
          const nextPts: number[] = [];
          for (let i = 0; i < pts.length; i += 2) nextPts.push((pts[i] || 0) + offX, (pts[i + 1] || 0) + offY);
          line.position({ x: 0, y: 0 });
          line.points(nextPts);
        } catch {
          /* ignore */
        }
        try {
          this.transformer?.forceUpdate?.();
          this.updateSelectionHitRect();
        } catch {
          /* ignore */
        }
        this.contentLayer?.batchDraw();
        this.uiLayer?.batchDraw();
      });
      group.add(line);
      return;
    }

    if (ann.type === "highlight" && v === 2 && data.kind === "stroke" && Array.isArray(data.pointsNorm)) {
      const points: number[] = [];
      for (let i = 0; i < data.pointsNorm.length; i += 2) points.push((data.pointsNorm[i] || 0) * pageW, (data.pointsNorm[i + 1] || 0) * pageH);
      const line = new Konva.Line({
        points,
        stroke: data.color || "#FFF066",
        strokeWidth: data.width || 12,
        opacity: typeof data.opacity === "number" ? data.opacity : 0.75,
        lineCap: "round",
        lineJoin: "round",
        tension: 0.5,
        // Marker-like visual over text
        globalCompositeOperation: "multiply",
        perfectDrawEnabled: false,
        shadowForStrokeEnabled: false,
        hitStrokeWidth: Math.max(44, (data.width || 12) * 10),
        id: ann.id,
        draggable: false,
        listening: true,
      });
      // Legacy highlight strokes (kept for backward compatibility).
      // New highlight behavior uses rectNorm + DOM layer behind text.
      group.add(line);
      return;
    }

    if (ann.type === "highlight" && data.rectNorm) {
      this.upsertHighlightDomFromRectNorm({
        pageNum,
        id: ann.id,
        rectNorm: data.rectNorm,
        color: typeof data.color === "string" ? data.color : this.highlightSettings.color,
        opacity: typeof data.opacity === "number" ? data.opacity : this.highlightSettings.opacity,
      });
      return;
    }

    if (ann.type === "freetext" && data.kind === "textbox") {
      const x = v === 2 && typeof data.xNorm === "number" ? data.xNorm * pageW : (data.x || 0);
      const y = v === 2 && typeof data.yNorm === "number" ? data.yNorm * pageH : (data.y || 0);
      const w = v === 2 && typeof data.widthNorm === "number" ? data.widthNorm * pageW : (data.width || 240);
      const h = v === 2 && typeof data.heightNorm === "number" ? data.heightNorm * pageH : (data.height || 90);
      const pad = typeof data.padding === "number" ? data.padding : 8;
      const box = new Konva.Group({ id: ann.id, x, y, draggable: true });
      const rect = new Konva.Rect({
        name: "textbox-rect",
        x: 0,
        y: 0,
        width: w,
        height: h,
        fill: data.bgColor || "rgba(255,255,255,0.0)",
        stroke: data.borderColor || "rgba(17,24,39,0.35)",
        strokeWidth: data.borderWidth ?? 1,
        cornerRadius: 4,
      });
      box.add(rect);
      this.renderTextboxRuns({ box, pageNum, pageW, pageH, data, w, h, pad });
      group.add(box);

      // Hard guarantee: dblclick on the textbox itself should always enter editor,
      // regardless of any UI-layer hit-rect/transformer interception.
      box.on("dblclick dbltap", (evt: any) => {
        try {
          evt.cancelBubble = true;
          evt.evt?.preventDefault?.();
        } catch {
          /* ignore */
        }
        if (this.currentMode !== "none") return;
        // entering editor should fully release selection-mode dragging
        try {
          box.stopDrag?.();
          box.draggable(false);
        } catch {
          /* ignore */
        }
        this.clearSelection();
        this.setMode("freetext");
        this.openTextBoxEditorForId(pageNum, ann.id);
      });

      // persist drag-move for textbox
      box.on("dragend._persist", () => {
        const metrics = this.pageMetrics.get(pageNum);
        const pageW2 = metrics?.width || 1;
        const pageH2 = metrics?.height || 1;
        const xNorm = Math.min(0.98, Math.max(0, box.x() / pageW2));
        const yNorm = Math.min(0.98, Math.max(0, box.y() / pageH2));
        this.recordUndo([pageNum], () => {
          const list = this.annotations[pageNum] || [];
          const target = list.find((a) => a.id === ann.id);
          if (!target) return;
          target.data = { ...(target.data || {}), v: 2, xNorm, yNorm };
        });
      });
      return;
    }
  }

  private normalizeTextRuns(runs: TextRun[], fallbackStyle: Omit<TextRun, "text">) {
    return normalizeTextRunsUtil({ runs, fallbackStyle });
  }

  private applyStyleToRuns(params: {
    runs: TextRun[];
    start: number;
    end: number;
    style: Partial<Pick<TextRun, "color" | "fontSize" | "fontWeight" | "italic" | "underline">>;
    fallbackStyle: Omit<TextRun, "text">;
  }) {
    return applyStyleToTextRuns({ ...params });
  }

  applyTextFormatToActiveSelection(params: { color?: string; fontSize?: number; fontWeight?: "normal" | "bold"; italic?: boolean; underline?: boolean }) {
    if (!this.activeTextEdit) return;
    const el = this.textEditingInput;
    if (!el) return;

    const getOffsetsFromContenteditable = (root: HTMLElement) => {
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return null;
      const r = sel.getRangeAt(0);
      if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
      const preStart = document.createRange();
      preStart.selectNodeContents(root);
      preStart.setEnd(r.startContainer, r.startOffset);
      const start = preStart.toString().length;
      const preEnd = document.createRange();
      preEnd.selectNodeContents(root);
      preEnd.setEnd(r.endContainer, r.endOffset);
      const end = preEnd.toString().length;
      return { start, end };
    };

    const se = (el as any).isContentEditable ? getOffsetsFromContenteditable(el) : null;
    if (!se || se.end <= se.start) return;

    const fallbackStyle = {
      color: "#111827",
      fontSize: 16,
      fontWeight: "normal" as const,
      italic: false,
      underline: false,
    };
    const next = this.applyStyleToRuns({
      runs: this.activeTextEdit.runs as any,
      start: se.start,
      end: se.end,
      style: {
        ...(typeof params.color === "string" ? { color: params.color } : {}),
        ...(typeof params.fontSize === "number" && Number.isFinite(params.fontSize) ? { fontSize: params.fontSize } : {}),
        ...(params.fontWeight === "normal" || params.fontWeight === "bold" ? { fontWeight: params.fontWeight } : {}),
        ...(typeof params.italic === "boolean" ? { italic: params.italic } : {}),
        ...(typeof params.underline === "boolean" ? { underline: params.underline } : {}),
      },
      fallbackStyle,
    });
    this.activeTextEdit.runs = next as any;
  }

  private renderTextboxRuns(params: { box: Konva.Group; pageNum: number; pageW: number; pageH: number; data: any; w: number; h: number; pad: number }) {
    const { box, pageH, data, w, h, pad } = params;
    let textGroup = box.findOne(".textbox-richtext") as Konva.Group | null;
    if (!textGroup) {
      textGroup = new Konva.Group({ name: "textbox-richtext", x: pad, y: pad });
      box.add(textGroup);
    } else {
      textGroup.position({ x: pad, y: pad });
    }
    try {
      textGroup.destroyChildren();
    } catch {
      /* ignore */
    }

    const fontFamily = String(data.fontFamily || "Arial");
    const defaultColor = String(data.color || "#111827");
    const defaultWeight: "normal" | "bold" = data.fontWeight === "bold" ? "bold" : "normal";
    const defaultItalic = !!data.italic;
    const defaultUnderline = !!data.underline;
    const defaultFontSize = typeof data.fontSizeNorm === "number" ? Math.max(10, data.fontSizeNorm * pageH) : 16;

    const runsPx: Array<{ text: string; color: string; fontSize: number; fontWeight: "normal" | "bold"; italic?: boolean; underline?: boolean }> =
      Array.isArray(data.runs) && data.runs.length
        ? (data.runs as any[]).map((r) => ({
            text: String(r?.text ?? ""),
            color: String(r?.color || defaultColor),
            fontWeight: r?.fontWeight === "bold" ? "bold" : "normal",
            italic: !!r?.italic,
            underline: !!r?.underline,
            fontSize: typeof r?.fontSizeNorm === "number" ? Math.max(10, r.fontSizeNorm * pageH) : typeof r?.fontSize === "number" ? r.fontSize : defaultFontSize,
          }))
        : [{ text: String(data.text || ""), color: defaultColor, fontSize: defaultFontSize, fontWeight: defaultWeight, italic: defaultItalic, underline: defaultUnderline }];

    const normalized = this.normalizeTextRuns(runsPx as any, {
      color: defaultColor,
      fontSize: defaultFontSize,
      fontWeight: defaultWeight,
      italic: false,
      underline: false,
    }) as any[];

    const maxW = Math.max(1, w - pad * 2);
    const maxH = Math.max(1, h - pad * 2);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const measure = (text: string, font: string) => {
      if (!ctx) return text.length * 8;
      ctx.font = font;
      return ctx.measureText(text).width;
    };

    let cursorX = 0;
    let cursorY = 0;
    let lineH = Math.max(14, defaultFontSize * 1.25);
    const newLine = () => {
      cursorX = 0;
      cursorY += lineH;
      lineH = Math.max(14, defaultFontSize * 1.25);
    };

    for (const rr of normalized) {
      const t = String(rr?.text ?? "");
      if (!t) continue;
      const color = String(rr?.color || defaultColor);
      const fontWeight: "normal" | "bold" = rr?.fontWeight === "bold" ? "bold" : "normal";
      const italic = !!rr?.italic;
      const underline = !!rr?.underline;
      const fontSizePx = Math.max(10, Number(rr?.fontSize || defaultFontSize));
      const fontStyle = fontWeight === "bold" && italic ? "bold italic" : fontWeight === "bold" ? "bold" : italic ? "italic" : "normal";
      const font = `${fontStyle} ${fontSizePx}px ${fontFamily}`;
      const segLineH = Math.max(14, fontSizePx * 1.25);

      let i = 0;
      while (i < t.length) {
        const ch = t[i]!;
        if (ch === "\n") {
          newLine();
          i += 1;
          continue;
        }

        const availableW = Math.max(1, maxW - cursorX);
        let j = i + 1;
        let best = i;
        while (j <= t.length) {
          const slice = t.slice(i, j);
          const wPx = measure(slice, font);
          if (wPx <= availableW) {
            best = j;
            j += 1;
            continue;
          }
          break;
        }
        if (best === i) {
          if (cursorX > 0) {
            newLine();
            continue;
          }
          best = i + 1;
        }
        const chunk = t.slice(i, best);
        const wPx = measure(chunk, font);
        if (cursorY + segLineH > maxH + 1) return;

        const node = new Konva.Text({
          x: cursorX,
          y: cursorY,
          text: chunk,
          fontFamily,
          fontSize: fontSizePx,
          fontStyle,
          textDecoration: underline ? "underline" : "",
          fill: color,
          listening: false,
        });
        textGroup.add(node);
        cursorX += wPx;
        lineH = Math.max(lineH, segLineH);
        i = best;
        if (cursorX >= maxW - 0.5) newLine();
      }
    }
  }

  private bindStageEvents() {
    if (!this.stage) return;
    const stage = this.stage;

    // Never allow touch to start Konva dragging (touch is reserved for app gestures).
    stage.on("dragstart", (evt: any) => {
      try {
        if (getPointerKind(evt?.evt) !== "touch") return;
      } catch {
        return;
      }
      try {
        evt.cancelBubble = true;
      } catch {
        /* ignore */
      }
      try {
        evt.target?.stopDrag?.();
      } catch {
        /* ignore */
      }
    });

    const hitTestPage = (pos: { x: number; y: number }): number | null => {
      for (const [page, m] of this.pageMetrics.entries()) {
        if (pos.x >= m.x && pos.x <= m.x + m.width && pos.y >= m.y && pos.y <= m.y + m.height) return page;
      }
      return null;
    };

    const getPageLocal = (page: number, pos: { x: number; y: number }) => {
      const m = this.pageMetrics.get(page);
      if (!m) return null;
      return { x: pos.x - m.x, y: pos.y - m.y, w: m.width, h: m.height };
    };

    stage.on("dblclick dbltap", (evt: Konva.KonvaEventObject<PointerEvent>) => {
      if (this.currentMode !== "none") return;
      // On some browsers Konva may not have pointer position for dblclick; compute from event as fallback.
      let pos = stage.getPointerPosition();
      if (!pos) {
        try {
          const e = evt.evt as any;
          const box = stage.container().getBoundingClientRect();
          const cx = typeof e?.clientX === "number" ? e.clientX : typeof e?.x === "number" ? e.x : null;
          const cy = typeof e?.clientY === "number" ? e.clientY : typeof e?.y === "number" ? e.y : null;
          if (cx != null && cy != null) pos = { x: cx - box.left, y: cy - box.top } as any;
        } catch {
          /* ignore */
        }
      }
      if (!pos || !Number.isFinite((pos as any).x) || !Number.isFinite((pos as any).y)) return;
      let rawHit = stage.getIntersection(pos);
      // UI layer nodes (selection hit-rect, transformer handles, etc.) can intercept hits.
      // For dblclick-to-edit we want the underlying annotation node on the content layer.
      try {
        const isUiLayerHit = (n: any) => {
          if (!n) return false;
          try {
            if (this.selectionHitRect && (n === this.selectionHitRect || n?.hasName?.("selection-hit-rect"))) return true;
          } catch {
            /* ignore */
          }
          try {
            const layer = n.getLayer?.();
            if (layer && this.uiLayer && layer === this.uiLayer) return true;
          } catch {
            /* ignore */
          }
          return false;
        };
        if (rawHit && isUiLayerHit(rawHit as any)) {
          rawHit = (this.contentLayer as any)?.getIntersection?.(pos) ?? null;
        }
      } catch {
        /* ignore */
      }
      const node = rawHit ? (this.resolveAnnotationNode(rawHit as any) || (rawHit as any)) : null;
      if (!node) return;
      const id = node.id?.();
      if (!id || id.startsWith("page-")) return;
      const page = this.getPageForNode(node);
      if (!page) return;
      const ann = (this.annotations[page] || []).find((a) => a.id === id);
      if (!ann) return;
      if (ann.type === "freetext" && ann.data?.kind === "textbox") {
        try {
          evt.cancelBubble = true;
          (evt.evt as any)?.preventDefault?.();
        } catch {
          /* ignore */
        }
        // entering editor should fully release selection-mode dragging
        try {
          (node as any).stopDrag?.();
          (node as any).draggable?.(false);
        } catch {
          /* ignore */
        }
        this.clearSelection();
        this.setMode("freetext");
        this.openTextBoxEditorForId(page, id);
      }
    });

    stage.on("pointerdown", (evt: Konva.KonvaEventObject<PointerEvent>) => {
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const docPos = this.stageToDoc(pos);

      // Touch is reserved for app-level gestures (scroll/pinch). Ignore all annotation interactions.
      if (getPointerKind((evt as any)?.evt) === "touch") return;

      if (this.currentMode === "none") {
        const rawHit = stage.getIntersection(pos);
        const node = rawHit ? (this.resolveAnnotationNode(rawHit as any) || (rawHit as any)) : null;
        const shift = !!(evt.evt as any)?.shiftKey;
        if (node) {
          const next = shift ? Array.from(new Set([...this.selectedNodes, node])) : [node];
          this.setSelection(next);
        } else {
          // If the pointer is over a DOM-based highlight, allow selecting it (for delete)
          const hit = this.stageRectContainsDomHighlight(pos);
          if (hit?.id && hit.rect) {
            if (!shift) this.clearSelection();
            const outline = new Konva.Rect({
              id: hit.id,
              x: hit.rect.x,
              y: hit.rect.y,
              width: Math.max(1, hit.rect.width),
              height: Math.max(1, hit.rect.height),
              name: "hl-outline",
              strokeWidth: 0,
              fill: "rgba(0,0,0,0.001)",
              listening: false,
            });
            this.uiLayer?.add(outline);
            const next = shift ? Array.from(new Set([...this.selectedNodes, outline])) : [outline];
            this.setSelection(next);
            this.uiLayer?.batchDraw();
            return;
          }
          // start marquee selection for mouse/pen
          this.isMarqueeSelecting = true;
          this.marqueeStart = { x: pos.x, y: pos.y };
          this.marqueeAdditive = shift;
          try {
            this.marqueeRect?.destroy();
          } catch {
            /* ignore */
          }
          this.marqueeRect = new Konva.Rect({
            x: pos.x,
            y: pos.y,
            width: 0,
            height: 0,
            stroke: "#6366f1",
            strokeWidth: 1,
            dash: [6, 4],
            fill: "rgba(99, 102, 241, 0.08)",
            listening: false,
          });
          this.uiLayer?.add(this.marqueeRect);
          this.uiLayer?.batchDraw();
        }
        return;
      }

      if (this.currentMode === "eraser") {
        this.isErasing = true;
        this.eraseAt(pos);
        return;
      }

      const page = hitTestPage(docPos);
      if (!page) return;
      this.activePage = page;
      const local = getPageLocal(page, docPos);
      if (!local) return;

      if (this.currentMode === "freetext") {
        if (this.textEditingInput) return;
        this.isTextBoxCreating = true;
        this.textBoxStart = { page, x: local.x, y: local.y };
        const m = this.pageMetrics.get(page);
        if (!m) return;
        if (this.textBoxPreview) this.textBoxPreview.destroy();
        this.textBoxPreview = new Konva.Rect({
          x: m.x + local.x,
          y: m.y + local.y,
          width: 1,
          height: 1,
          stroke: "#6366f1",
          strokeWidth: 1,
          dash: [4, 3],
          fill: "rgba(99, 102, 241, 0.06)",
          listening: false,
        });
        this.uiLayer?.add(this.textBoxPreview);
        this.uiLayer?.batchDraw();
        return;
      }

      // highlight mode: same as PC — drag to select text on the layer below (stage has pointer-events none).
      // Selection is applied in document mouseup/pointerup via applyHighlightsFromNativeSelection.
      if (this.currentMode === "highlight") return;

      // ink drawing (freehand)
      if (this.currentMode === "ink") {
        this.isDrawing = true;
        this.currentPoints = [local.x, local.y];
        const g = this.getOrCreatePageGroup(page);
        this.currentDrawing = new Konva.Line({
          points: [local.x, local.y],
          stroke: this.inkSettings.color,
          strokeWidth: this.inkSettings.width,
          lineCap: "round",
          lineJoin: "round",
          tension: 0.35,
          perfectDrawEnabled: false,
          shadowForStrokeEnabled: false,
          listening: false,
        });
        g.add(this.currentDrawing);
        this.contentLayer?.batchDraw();
      }
    });

    stage.on("pointermove", (evt: Konva.KonvaEventObject<PointerEvent>) => {
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const docPos = this.stageToDoc(pos);

      if (this.currentMode === "none" && this.isSelectionDragging && this.selectionDragStart) {
        const docPos = this.stageToDoc(pos);
        const dx = docPos.x - this.selectionDragStart.x;
        const dy = docPos.y - this.selectionDragStart.y;
        for (const it of this.selectionDragStartNodes) {
          try {
            const parent = it.node.getParent();
            if (!parent) continue;
            it.node.position({ x: it.docX + dx - parent.x(), y: it.docY + dy - parent.y() });
          } catch {
            /* ignore */
          }
        }
        try {
          this.transformer?.forceUpdate?.();
        } catch {
          /* ignore */
        }
        try {
          this.updateSelectionHitRect();
        } catch {
          /* ignore */
        }
        this.contentLayer?.batchDraw();
        this.uiLayer?.batchDraw();
        return;
      }

      if (this.currentMode === "none" && this.isMarqueeSelecting && this.marqueeStart && this.marqueeRect) {
        const x1 = this.marqueeStart.x;
        const y1 = this.marqueeStart.y;
        const x = Math.min(x1, pos.x);
        const y = Math.min(y1, pos.y);
        const w = Math.abs(pos.x - x1);
        const h = Math.abs(pos.y - y1);
        this.marqueeRect.position({ x, y });
        this.marqueeRect.size({ width: w, height: h });
        this.uiLayer?.batchDraw();
        return;
      }

      if (this.currentMode === "eraser" && this.isErasing) {
        this.eraseAt(pos);
        return;
      }

      if (this.currentMode === "freetext" && this.isTextBoxCreating && this.textBoxStart && this.textBoxPreview) {
        const page = this.textBoxStart.page;
        const m = this.pageMetrics.get(page);
        if (!m) return;
        const local = getPageLocal(page, docPos);
        if (!local) return;
        const x1 = this.textBoxStart.x;
        const y1 = this.textBoxStart.y;
        const x = Math.min(x1, local.x);
        const y = Math.min(y1, local.y);
        const w = Math.max(120, Math.abs(local.x - x1));
        const h = Math.max(60, Math.abs(local.y - y1));
        this.textBoxPreview.position({ x: m.x + x, y: m.y + y });
        this.textBoxPreview.size({ width: w, height: h });
        this.uiLayer?.batchDraw();
        return;
      }

      if (!this.isDrawing || !this.activePage) return;
      const page = this.activePage;
      const local = getPageLocal(page, docPos);
      if (!local) return;
      this.currentPoints.push(local.x, local.y);
      if (this.currentDrawing) {
        this.currentDrawing.points(this.currentPoints);
        this.contentLayer?.batchDraw();
      }
    });

    stage.on("pointerup", () => {
      const pos = stage.getPointerPosition();
      const docPos = pos ? this.stageToDoc(pos) : null;

      if (this.currentMode === "none" && this.isSelectionDragging && this.selectionDragStart) {
        const docPosNow = pos ? this.stageToDoc(pos) : this.selectionDragStart;
        const dxPx = docPosNow.x - this.selectionDragStart.x;
        const dyPx = docPosNow.y - this.selectionDragStart.y;
        this.isSelectionDragging = false;
        this.selectionDragStart = null;

        const moved = Math.abs(dxPx) > 0.5 || Math.abs(dyPx) > 0.5;
        const startNodes = this.selectionDragStartNodes;
        this.selectionDragStartNodes = [];

        if (moved && startNodes.length) {
          const perPage: Map<number, Array<{ id: string; node: Konva.Node; dx: number; dy: number }>> = new Map();
          for (const it of startNodes) {
            const id = it.node.id?.();
            if (!id) continue;
            const pageNum = this.getPageForNode(it.node);
            if (!pageNum) continue;
            const parent = it.node.getParent();
            const curDocX = (parent ? parent.x() : 0) + (it.node.x() ?? 0);
            const curDocY = (parent ? parent.y() : 0) + (it.node.y() ?? 0);
            const dx = curDocX - it.docX;
            const dy = curDocY - it.docY;
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
            const arr = perPage.get(pageNum) ?? [];
            arr.push({ id, node: it.node, dx, dy });
            perPage.set(pageNum, arr);
          }

          const pages = Array.from(perPage.keys());
          this.recordUndo(pages, () => {
            for (const [pageNum, items] of perPage.entries()) {
              const metrics = this.pageMetrics.get(pageNum);
              const pageW = metrics?.width || 1;
              const pageH = metrics?.height || 1;
              const list = this.annotations[pageNum] || [];
              for (const mv of items) {
                const ann = list.find((a) => a.id === mv.id);
                if (!ann) continue;
                const dxNorm = mv.dx / pageW;
                const dyNorm = mv.dy / pageH;
                const data = ann.data || {};

                if (ann.type === "freetext" && data.kind === "textbox") {
                  ann.data = {
                    ...(ann.data || {}),
                    v: 2,
                    xNorm: Math.min(0.98, Math.max(0, Number(data.xNorm || 0) + dxNorm)),
                    yNorm: Math.min(0.98, Math.max(0, Number(data.yNorm || 0) + dyNorm)),
                  };
                  continue;
                }

                if (ann.type === "highlight" && data.rectNorm) {
                  ann.data = {
                    ...(ann.data || {}),
                    rectNorm: {
                      ...data.rectNorm,
                      x: Math.min(0.98, Math.max(0, Number(data.rectNorm.x || 0) + dxNorm)),
                      y: Math.min(0.98, Math.max(0, Number(data.rectNorm.y || 0) + dyNorm)),
                    },
                  };
                  continue;
                }

                if (ann.type === "ink" && data.v === 2 && Array.isArray(data.pointsNorm)) {
                  const out: number[] = [];
                  for (let i = 0; i < data.pointsNorm.length; i += 2) {
                    out.push(Math.min(0.98, Math.max(0, (data.pointsNorm[i] || 0) + dxNorm)));
                    out.push(Math.min(0.98, Math.max(0, (data.pointsNorm[i + 1] || 0) + dyNorm)));
                  }
                  ann.data = { ...(ann.data || {}), pointsNorm: out };
                  continue;
                }

                if (ann.type === "highlight" && data.v === 2 && data.kind === "stroke" && Array.isArray(data.pointsNorm)) {
                  const out: number[] = [];
                  for (let i = 0; i < data.pointsNorm.length; i += 2) {
                    out.push(Math.min(0.98, Math.max(0, (data.pointsNorm[i] || 0) + dxNorm)));
                    out.push(Math.min(0.98, Math.max(0, (data.pointsNorm[i + 1] || 0) + dyNorm)));
                  }
                  ann.data = { ...(ann.data || {}), pointsNorm: out };
                  continue;
                }
              }
            }
          });

          // Rebase moved lines back to (0,0) offset to keep data-model consistent
          for (const [, items] of perPage.entries()) {
            for (const mv of items) {
              const n = mv.node;
              try {
                if (n instanceof Konva.Line) {
                  const offX = n.x();
                  const offY = n.y();
                  if (Math.abs(offX) > 0.01 || Math.abs(offY) > 0.01) {
                    const pts = n.points();
                    const nextPts: number[] = [];
                    for (let i = 0; i < pts.length; i += 2) nextPts.push((pts[i] || 0) + offX, (pts[i + 1] || 0) + offY);
                    n.position({ x: 0, y: 0 });
                    n.points(nextPts);
                  }
                }
                // Ensure textbox remains draggable after selection drag
                if (n instanceof Konva.Group) {
                  n.draggable(true);
                }
              } catch {
                /* ignore */
              }
            }
          }
        }

        try {
          this.transformer?.forceUpdate?.();
        } catch {
          /* ignore */
        }
        try {
          this.updateSelectionHitRect();
        } catch {
          /* ignore */
        }
        this.contentLayer?.batchDraw();
        this.uiLayer?.batchDraw();
        return;
      }

      if (this.currentMode === "none" && this.isMarqueeSelecting && this.marqueeRect) {
        this.isMarqueeSelecting = false;
        const rect = this.marqueeRect.getClientRect({ skipTransform: false });
        const additive = this.marqueeAdditive;
        this.marqueeAdditive = false;
        this.marqueeStart = null;
        try {
          this.marqueeRect.destroy();
        } catch {
          /* ignore */
        }
        this.marqueeRect = null;
        this.uiLayer?.batchDraw();

        const hit = this.getSelectableNodes().filter((n) => {
          try {
            return Konva.Util.haveIntersection(rect, n.getClientRect({ skipTransform: false }));
          } catch {
            return false;
          }
        });

        // Also include DOM-based highlight rectangles (rectNorm) that intersect the marquee box.
        const outlineNodes: Konva.Node[] = [];
        try {
          const existingIds = new Set((additive ? this.selectedNodes : []).map((n) => n?.id?.()).filter(Boolean) as string[]);
          for (const [id, el] of Array.from(this.highlightDomById.entries())) {
            if (!el || !el.isConnected) continue;
            if (!id || existingIds.has(id)) continue;
            const dr = el.getBoundingClientRect();
            const stageRect = this.domRectToStageRect(dr);
            if (!stageRect) continue;
            if (!Konva.Util.haveIntersection(rect, stageRect as any)) continue;
            const outline = new Konva.Rect({
              id,
              x: stageRect.x,
              y: stageRect.y,
              width: Math.max(1, stageRect.width),
              height: Math.max(1, stageRect.height),
              name: "hl-outline",
              strokeWidth: 0,
              fill: "rgba(0,0,0,0.001)",
              listening: false,
            });
            this.uiLayer?.add(outline);
            outlineNodes.push(outline);
            existingIds.add(id);
          }
        } catch {
          /* ignore */
        }

        const base = additive ? this.selectedNodes : [];
        const next = Array.from(new Set([...base, ...hit, ...outlineNodes]));
        this.setSelection(next);
        this.uiLayer?.batchDraw();
        return;
      }

      if (this.currentMode === "eraser") {
        this.isErasing = false;
        this.lastErasedId = null;
        return;
      }

      // finalize textbox creation
      if (this.currentMode === "freetext" && this.isTextBoxCreating && this.textBoxStart && pos) {
        const page = this.textBoxStart.page;
        const m = this.pageMetrics.get(page);
        this.isTextBoxCreating = false;
        if (!m) return;
        const local = docPos ? getPageLocal(page, docPos) : null;
        let x = this.textBoxStart.x;
        let y = this.textBoxStart.y;
        let w = 240;
        let h = 90;
        if (local) {
          x = Math.min(this.textBoxStart.x, local.x);
          y = Math.min(this.textBoxStart.y, local.y);
          w = Math.max(120, Math.abs(local.x - this.textBoxStart.x));
          h = Math.max(60, Math.abs(local.y - this.textBoxStart.y));
        }
        try {
          this.textBoxPreview?.destroy();
        } catch {
          /* ignore */
        }
        this.textBoxPreview = null;
        this.textBoxStart = null;
        this.uiLayer?.batchDraw();

        const pageW = m.width || 1;
        const pageH = m.height || 1;
        const id = this.newId("textbox");
        const ann: Annotation = {
          id,
          type: "freetext",
          page,
          data: {
            v: 2,
            kind: "textbox",
            xNorm: x / pageW,
            yNorm: y / pageH,
            widthNorm: Math.min(0.95, w / pageW),
            heightNorm: Math.min(0.95, h / pageH),
            padding: 8,
            text: "",
            runs: [{ text: "", color: "#111827", fontWeight: "normal", italic: false, underline: false, fontSizeNorm: 16 / pageH }],
            fontFamily: "Arial",
            fontSizeNorm: 16 / pageH,
            color: "#111827",
            italic: false,
            underline: false,
            bgColor: "rgba(255,255,255,0)",
            borderColor: "rgba(17,24,39,0.35)",
            borderWidth: 1,
            align: "left",
          },
          created_at: new Date().toISOString(),
        };
        this.recordUndo([page], () => {
          if (!this.annotations[page]) this.annotations[page] = [];
          this.annotations[page].push(ann);
        });
        const g = this.getOrCreatePageGroup(page);
        this.loadAnnotationToGroup(ann, g, page);
        this.contentLayer?.batchDraw();
        // open editor immediately
        this.openTextBoxEditorForId(page, id);
        return;
      }

      // finalize ink drawing
      if (!this.isDrawing || !this.activePage) return;
      const page = this.activePage;
      const m = this.pageMetrics.get(page);
      const pageW = m?.width || 1;
      const pageH = m?.height || 1;
      this.isDrawing = false;
      this.activePage = null;

      if (!this.currentDrawing) return;
      const pts = this.currentPoints;
      const id = this.newId("ink");
      const pointsNorm: number[] = [];
      for (let i = 0; i < pts.length; i += 2) pointsNorm.push((pts[i] || 0) / pageW, (pts[i + 1] || 0) / pageH);
      const ann: Annotation = {
        id,
        type: "ink",
        page,
        data: { v: 2, pointsNorm, color: this.inkSettings.color, width: this.inkSettings.width },
        created_at: new Date().toISOString(),
      };
      this.recordUndo([page], () => {
        if (!this.annotations[page]) this.annotations[page] = [];
        this.annotations[page].push(ann);
      });
      this.currentDrawing.id(id);
      try {
        this.currentDrawing.listening(true);
      } catch {
        /* ignore */
      }
      this.currentDrawing = null;
      this.currentPoints = [];
      this.contentLayer?.batchDraw();
    });
  }

  private eraseAt(pos: { x: number; y: number }) {
    // 1) Try erasing Konva-rendered annotations (ink/text/legacy highlight stroke)
    const raw = this.stage?.getIntersection(pos) as any;
    const node = raw ? (this.resolveAnnotationNode(raw as any) || (raw as any)) : null;
    if (node) {
      const id = node.id?.();
      if (!id) return;
      if (this.lastErasedId === id) return;
      this.lastErasedId = id;
      const page = this.getPageForNode(node);
      if (!page) return;
      const list = this.annotations[page] || [];
      const idx = list.findIndex((a) => a.id === id);
      if (idx < 0) return;
      this.recordUndo([page], () => {
        list.splice(idx, 1);
        this.annotations[page] = list;
        node.destroy();
      });
      this.contentLayer?.batchDraw();
      this.uiLayer?.batchDraw();
      // If it was a DOM highlight (unlikely here), ensure cleanup too.
      this.removeHighlightDomById(id);
      return;
    }

    // 2) Try erasing DOM-rendered highlight rectangles (behind textLayer)
    const hit = this.stageRectContainsDomHighlight(pos);
    if (!hit?.id) return;
    const id = hit.id;
    // Find which page list contains this id
    let pageNum: number | null = null;
    for (const [pStr, list] of Object.entries(this.annotations)) {
      const p = Number(pStr);
      if (!Number.isFinite(p)) continue;
      if ((list || []).some((a) => a?.id === id)) {
        pageNum = p;
        break;
      }
    }
    if (!pageNum) return;
    const list = this.annotations[pageNum] || [];
    const idx = list.findIndex((a) => a?.id === id);
    if (idx < 0) return;
    this.recordUndo([pageNum], () => {
      list.splice(idx, 1);
      this.annotations[pageNum!] = list;
    });
    this.removeHighlightDomById(id);
    this.refreshHighlightDomForPage(pageNum);
  }

  private openTextBoxEditorForId(pageNum: number, id: string) {
    const list = this.annotations[pageNum] || [];
    const ann = list.find((a) => a.id === id);
    if (!ann) return;
    const data = ann.data || {};
    if (data.kind !== "textbox") return;
    if (!this.stage) return;
    const m = this.pageMetrics.get(pageNum);
    if (!m) return;
    const pageW = m.width || 1;
    const pageH = m.height || 1;

    const x = (data.xNorm || 0) * pageW;
    const y = (data.yNorm || 0) * pageH;
    const w = Math.max(120, (data.widthNorm || 0.2) * pageW);
    const h = Math.max(60, (data.heightNorm || 0.1) * pageH);

    this.cleanupTextEditorDom();

    // Hide the underlying Konva annotation while editing to avoid double-rendering
    // (contenteditable overlay + Konva text).
    let underlyingPrevVisible = true;
    let underlyingPrevListening = true;
    const restoreUnderlying = () => {
      try {
        const g = this.getOrCreatePageGroup(pageNum);
        const node = g.findOne(`#${id}`) as any;
        if (node) {
          node.visible?.(underlyingPrevVisible);
          node.listening?.(underlyingPrevListening);
        }
      } catch {
        /* ignore */
      }
    };
    try {
      const g = this.getOrCreatePageGroup(pageNum);
      const node = g.findOne(`#${id}`) as any;
      if (node) {
        underlyingPrevVisible = typeof node.visible === "function" ? !!node.visible() : true;
        underlyingPrevListening = typeof node.listening === "function" ? !!node.listening() : true;
        node.visible?.(false);
        node.listening?.(false);
        this.contentLayer?.batchDraw();
      }
    } catch {
      /* ignore */
    }

    const stageBox = this.stage.container().getBoundingClientRect();
    // Stage is viewport-sized and layers are translated by (-viewOffset).
    // Convert document coords -> stage coords by subtracting viewOffset.
    const screenX = stageBox.left + (m.x + x - this.viewOffset.x);
    const screenY = stageBox.top + (m.y + y - this.viewOffset.y);

    const EDIT_MIN_W = 320;
    const TOPBAR_H = 38;
    const EDIT_MIN_TEXT_H = 100;
    const EDIT_MIN_H = TOPBAR_H + EDIT_MIN_TEXT_H;

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.left = `${screenX}px`;
    overlay.style.top = `${screenY - TOPBAR_H}px`;
    overlay.style.width = `${Math.max(EDIT_MIN_W, w)}px`;
    overlay.style.height = `${Math.max(EDIT_MIN_H, h + TOPBAR_H)}px`;
    overlay.style.zIndex = "10000";
    overlay.style.background = "white";
    overlay.style.border = "2px solid #6366f1";
    overlay.style.borderRadius = "10px";
    overlay.style.boxShadow = "0 14px 34px rgba(0,0,0,0.14)";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.overflow = "hidden";
    overlay.style.resize = "both";
    overlay.style.minWidth = `${EDIT_MIN_W}px`;
    overlay.style.minHeight = `${EDIT_MIN_H}px`;

    const topbar = document.createElement("div");
    topbar.style.height = `${TOPBAR_H}px`;
    topbar.style.flex = `0 0 ${TOPBAR_H}px`;
    topbar.style.display = "flex";
    topbar.style.alignItems = "center";
    topbar.style.gap = "8px";
    topbar.style.padding = "6px 8px";
    topbar.style.background = "rgba(249,250,251,0.98)";
    topbar.style.borderBottom = "1px solid rgba(17,24,39,0.14)";
    topbar.addEventListener(
      "mousedown",
      (e) => {
        // IMPORTANT: don't stop propagation here, otherwise toolbar controls won't work.
        // Only prevent default when clicking the topbar background itself.
        if (e.target === topbar) e.preventDefault();
      },
      { capture: true }
    );

    const content = document.createElement("div");
    content.style.flex = "1 1 auto";
    content.style.overflow = "auto";

    const ed = document.createElement("div");
    ed.contentEditable = "true";
    ed.spellcheck = false;
    ed.style.minHeight = "100%";
    ed.style.outline = "none";
    ed.style.whiteSpace = "pre-wrap";
    ed.style.wordBreak = "break-word";
    const padPx = typeof data.padding === "number" ? data.padding : 8;
    ed.style.padding = `${padPx}px`;
    const baseFontSize = typeof data.fontSizeNorm === "number" ? Math.max(10, data.fontSizeNorm * pageH) : 16;
    const baseColor = String(data.color || "#111827");
    const baseWeight: "normal" | "bold" = data.fontWeight === "bold" ? "bold" : "normal";
    const baseItalic = !!data.italic;
    const baseUnderline = !!data.underline;
    ed.style.fontSize = `${baseFontSize}px`;
    ed.style.fontFamily = String(data.fontFamily || "Arial");
    ed.style.color = baseColor;
    ed.style.fontWeight = baseWeight;
    ed.style.fontStyle = baseItalic ? "italic" : "normal";
    ed.style.textDecoration = baseUnderline ? "underline" : "none";
    ed.style.background = "transparent";

    // apply bgColor to overlay at start
    try {
      const bg = typeof data.bgColor === "string" && data.bgColor.trim() ? data.bgColor.trim() : "";
      if (bg) overlay.style.background = bg;
    } catch {
      /* ignore */
    }

    overlay.appendChild(topbar);
    overlay.appendChild(content);
    content.appendChild(ed);
    document.body.appendChild(overlay);
    this.textEditingOverlay = overlay;
    this.textEditingInput = ed;
    ed.focus();

    // init runs
    const initRuns: TextRun[] =
      Array.isArray(data.runs) && data.runs.length
        ? (data.runs as any[]).map((r) => ({
            text: String(r?.text ?? ""),
            color: String(r?.color || baseColor),
            fontSize: typeof r?.fontSizeNorm === "number" ? Math.max(10, r.fontSizeNorm * pageH) : baseFontSize,
            fontWeight: r?.fontWeight === "bold" ? ("bold" as const) : ("normal" as const),
            italic: !!r?.italic,
            underline: !!r?.underline,
          }))
        : [{ text: String(data.text || ""), color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight, italic: baseItalic, underline: baseUnderline }];

    this.activeTextEdit = { pageNum, id, pageH, runs: normalizeTextRunsUtil({ runs: initRuns, fallbackStyle: { color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight, italic: false, underline: false } }) };

    // render runs into editable DOM once (do NOT rebuild during IME input)
    const renderEditor = () => {
      const runs = this.activeTextEdit?.id === id ? (this.activeTextEdit.runs as any[]) : [];
      while (ed.firstChild) ed.removeChild(ed.firstChild);
      for (const r of runs) {
        const span = document.createElement("span");
        span.style.color = String(r?.color || baseColor);
        span.style.fontSize = `${Math.max(10, Number(r?.fontSize || baseFontSize))}px`;
        span.style.fontWeight = r?.fontWeight === "bold" ? "bold" : "normal";
        span.style.fontStyle = r?.italic ? "italic" : "normal";
        span.style.textDecoration = r?.underline ? "underline" : "none";
        span.appendChild(document.createTextNode(String(r?.text ?? "")));
        ed.appendChild(span);
      }
    };
    renderEditor();

    // selection helpers
    const captureSelection = () => {
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
      const r = sel.getRangeAt(0);
      if (!ed.contains(r.startContainer) || !ed.contains(r.endContainer)) return { start: 0, end: 0 };
      const preStart = document.createRange();
      preStart.selectNodeContents(ed);
      preStart.setEnd(r.startContainer, r.startOffset);
      const start = preStart.toString().length;
      const preEnd = document.createRange();
      preEnd.selectNodeContents(ed);
      preEnd.setEnd(r.endContainer, r.endOffset);
      const end = preEnd.toString().length;
      return { start, end };
    };
    const restoreSelection = (sel: { start: number; end: number }) => {
      try {
        ed.focus();
        const s = Math.max(0, Math.min(sel.start, sel.end));
        const e = Math.max(0, Math.max(sel.start, sel.end));
        const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
        let node: Text | null = walker.nextNode() as Text | null;
        let pos = 0;
        let startNode: Text | null = null;
        let startOff = 0;
        let endNode: Text | null = null;
        let endOff = 0;
        while (node) {
          const len = node.data.length;
          if (!startNode && pos + len >= s) {
            startNode = node;
            startOff = s - pos;
          }
          if (pos + len >= e) {
            endNode = node;
            endOff = e - pos;
            break;
          }
          pos += len;
          node = walker.nextNode() as Text | null;
        }
        if (!startNode || !endNode) return;
        const range = document.createRange();
        range.setStart(startNode, Math.max(0, Math.min(startOff, startNode.data.length)));
        range.setEnd(endNode, Math.max(0, Math.min(endOff, endNode.data.length)));
        const selection = window.getSelection?.();
        if (!selection) return;
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        /* ignore */
      }
    };

    // toolbar UI
    const mkBtn = (label: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.height = "26px";
      b.style.minWidth = "26px";
      b.style.padding = "0 8px";
      b.style.border = "1px solid rgba(17,24,39,0.18)";
      b.style.borderRadius = "6px";
      b.style.background = "white";
      b.style.cursor = "pointer";
      b.style.fontWeight = "700";
      return b;
    };
    const setBtnActive = (b: HTMLButtonElement, on: boolean) => {
      b.style.background = on ? "rgba(99,102,241,0.12)" : "white";
      b.style.borderColor = on ? "rgba(99,102,241,0.55)" : "rgba(17,24,39,0.18)";
    };

    let curColor = baseColor;
    let curFontSize = baseFontSize;
    let curBold = baseWeight === "bold";
    let curItalic = baseItalic;
    let curUnderline = baseUnderline;

    // IME composing guard
    let isComposing = false;
    ed.addEventListener("compositionstart", () => {
      isComposing = true;
    });
    ed.addEventListener("compositionend", () => {
      isComposing = false;
      try {
        window.setTimeout(() => syncRunsFromDom(), 0);
      } catch {
        /* ignore */
      }
    });

    const bgLabel = document.createElement("span");
    bgLabel.textContent = "BG";
    bgLabel.style.fontSize = "12px";
    bgLabel.style.opacity = "0.75";
    const bgColorInput = document.createElement("input");
    bgColorInput.type = "color";
    bgColorInput.value = typeof data.bgColor === "string" && data.bgColor.trim().startsWith("#") ? data.bgColor.trim() : "#ffffff";
    bgColorInput.style.position = "absolute";
    bgColorInput.style.width = "1px";
    bgColorInput.style.height = "1px";
    bgColorInput.style.opacity = "0";
    // keep it programmatically clickable for color picker
    bgColorInput.style.pointerEvents = "auto";
    const bgBtn = document.createElement("button");
    bgBtn.type = "button";
    bgBtn.style.width = "24px";
    bgBtn.style.height = "24px";
    bgBtn.style.borderRadius = "6px";
    bgBtn.style.border = "1px solid rgba(17,24,39,0.18)";
    bgBtn.style.background = bgColorInput.value;
    bgBtn.style.cursor = "pointer";
    bgBtn.title = "배경색";

    const fgLabel = document.createElement("span");
    fgLabel.textContent = "A";
    fgLabel.style.fontSize = "12px";
    fgLabel.style.opacity = "0.75";
    const fgColorInput = document.createElement("input");
    fgColorInput.type = "color";
    fgColorInput.value = baseColor;
    fgColorInput.style.position = "absolute";
    fgColorInput.style.width = "1px";
    fgColorInput.style.height = "1px";
    fgColorInput.style.opacity = "0";
    fgColorInput.style.pointerEvents = "auto";
    const fgBtn = document.createElement("button");
    fgBtn.type = "button";
    fgBtn.style.width = "24px";
    fgBtn.style.height = "24px";
    fgBtn.style.borderRadius = "6px";
    fgBtn.style.border = "1px solid rgba(17,24,39,0.18)";
    fgBtn.style.background = curColor;
    fgBtn.style.cursor = "pointer";
    fgBtn.title = "글자색(선택)";

    const sizeDec = mkBtn("−");
    const sizeInc = mkBtn("+");
    const sizeInput = document.createElement("input");
    sizeInput.type = "number";
    sizeInput.min = "10";
    sizeInput.max = "96";
    sizeInput.step = "1";
    sizeInput.value = String(curFontSize);
    (sizeInput as any).inputMode = "numeric";
    sizeInput.style.width = "54px";
    sizeInput.style.height = "26px";
    sizeInput.style.border = "1px solid rgba(17,24,39,0.18)";
    sizeInput.style.borderRadius = "6px";
    sizeInput.style.padding = "0 8px";
    sizeInput.style.fontSize = "12px";
    sizeInput.style.opacity = "0.95";
    sizeInput.style.outline = "none";
    sizeInput.title = "글자 크기 (선택 영역)";

    const btnB = mkBtn("B");
    const btnI = mkBtn("I");
    const btnU = mkBtn("U");
    setBtnActive(btnB, curBold);
    setBtnActive(btnI, curItalic);
    setBtnActive(btnU, curUnderline);

    const openColorPicker = (input: HTMLInputElement) => {
      const sel = captureSelection();
      try {
        // Prefer showPicker() when available (more reliable if input is tiny/hidden).
        (input as any).showPicker?.();
        if (!(input as any).showPicker) input.click();
      } catch {
        /* ignore */
      }
      try {
        window.setTimeout(() => restoreSelection(sel), 0);
      } catch {
        /* ignore */
      }
    };

    bgBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openColorPicker(bgColorInput);
    });
    bgColorInput.addEventListener("input", () => {
      const sel = captureSelection();
      const next = bgColorInput.value;
      bgBtn.style.background = next;
      try {
        overlay.style.background = next;
      } catch {
        /* ignore */
      }
      // persist
      this.recordUndo([pageNum], () => {
        ann.data = { ...(ann.data || {}), bgColor: next };
      });
      // update konva rect immediately
      try {
        const g = this.getOrCreatePageGroup(pageNum);
        const box = g.findOne(`#${id}`) as Konva.Group | null;
        const rect = box?.findOne?.(".textbox-rect") as Konva.Rect | null;
        if (rect) rect.fill(next);
        this.contentLayer?.batchDraw();
      } catch {
        /* ignore */
      }
      restoreSelection(sel);
    });

    fgBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openColorPicker(fgColorInput);
    });
    fgColorInput.addEventListener("input", () => {
      const sel = captureSelection();
      curColor = fgColorInput.value;
      fgBtn.style.background = curColor;
      applyToSelection({ color: curColor });
      restoreSelection(sel);
    });

    const setFontSize = (next: number) => {
      curFontSize = Math.max(10, Math.min(96, next));
      sizeInput.value = String(curFontSize);
      applyToSelection({ fontSize: curFontSize });
    };
    sizeDec.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = captureSelection();
      setFontSize(curFontSize - 1);
      restoreSelection(sel);
    });
    sizeInc.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = captureSelection();
      setFontSize(curFontSize + 1);
      restoreSelection(sel);
    });

    // Keep a sticky selection snapshot so toolbar inputs can apply to selected text
    // even if the input temporarily takes focus.
    let toolbarStickySel = { start: 0, end: 0 };
    const rememberSel = () => {
      try {
        toolbarStickySel = captureSelection();
      } catch {
        /* ignore */
      }
    };
    ed.addEventListener("mouseup", rememberSel);
    ed.addEventListener("keyup", rememberSel as any);

    sizeInput.addEventListener("mousedown", (e) => {
      rememberSel();
      e.stopPropagation();
    });
    sizeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        try {
          restoreSelection(toolbarStickySel);
        } catch {
          /* ignore */
        }
        const v = Number(sizeInput.value);
        if (Number.isFinite(v)) setFontSize(v);
        try {
          ed.focus();
        } catch {
          /* ignore */
        }
      }
    });

    btnB.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btnI.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btnU.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    btnB.addEventListener("click", () => {
      curBold = !curBold;
      setBtnActive(btnB, curBold);
      applyToSelection({ fontWeight: curBold ? "bold" : "normal" });
    });
    btnI.addEventListener("click", () => {
      curItalic = !curItalic;
      setBtnActive(btnI, curItalic);
      applyToSelection({ italic: curItalic });
    });
    btnU.addEventListener("click", () => {
      curUnderline = !curUnderline;
      setBtnActive(btnU, curUnderline);
      applyToSelection({ underline: curUnderline });
    });

    topbar.appendChild(bgLabel);
    topbar.appendChild(bgColorInput);
    topbar.appendChild(bgBtn);
    topbar.appendChild(fgLabel);
    topbar.appendChild(fgColorInput);
    topbar.appendChild(fgBtn);
    topbar.appendChild(sizeDec);
    topbar.appendChild(sizeInput);
    topbar.appendChild(sizeInc);
    topbar.appendChild(btnB);
    topbar.appendChild(btnI);
    topbar.appendChild(btnU);

    const applyDomStyleToSelection = (style: { color?: string; fontSize?: number; fontWeight?: "normal" | "bold"; italic?: boolean; underline?: boolean }) => {
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (r.collapsed) return;
      if (!ed.contains(r.startContainer) || !ed.contains(r.endContainer)) return;
      if (isComposing) return;
      const span = document.createElement("span");
      if (typeof style.color === "string") span.style.color = style.color;
      if (typeof style.fontSize === "number") span.style.fontSize = `${Math.max(10, style.fontSize)}px`;
      if (style.fontWeight) span.style.fontWeight = style.fontWeight;
      if (typeof style.italic === "boolean") span.style.fontStyle = style.italic ? "italic" : "normal";
      if (typeof style.underline === "boolean") span.style.textDecoration = style.underline ? "underline" : "none";
      const frag = r.extractContents();
      span.appendChild(frag);
      r.insertNode(span);
    };

    const applyToSelection = (style: { color?: string; fontSize?: number; fontWeight?: "normal" | "bold"; italic?: boolean; underline?: boolean }) => {
      const sel = captureSelection();
      this.applyTextFormatToActiveSelection(style);
      try {
        applyDomStyleToSelection(style);
      } catch {
        /* ignore */
      }
      try {
        restoreSelection(sel);
      } catch {
        /* ignore */
      }
      autoFitOverlayToContent();
      syncCaretStyle();
    };

    const measureRunsHeightPx = (runs: any[], maxW: number) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const measure = (text: string, font: string) => {
        if (!ctx) return text.length * 8;
        ctx.font = font;
        return ctx.measureText(text).width;
      };
      const fontFamily = String(data.fontFamily || "Arial");
      const defaultFontSize = baseFontSize;
      let cursorX = 0;
      let cursorY = 0;
      let lineH = Math.max(14, defaultFontSize * 1.25);
      const newLine = () => {
        cursorX = 0;
        cursorY += lineH;
        lineH = Math.max(14, defaultFontSize * 1.25);
      };
      for (const rr of runs) {
        const t = String(rr?.text ?? "");
        if (!t) continue;
        const fontWeight: "normal" | "bold" = rr?.fontWeight === "bold" ? "bold" : "normal";
        const italic = !!rr?.italic;
        const fontSizePx = Math.max(10, Number(rr?.fontSize || defaultFontSize));
        const fontStyle = fontWeight === "bold" && italic ? "bold italic" : fontWeight === "bold" ? "bold" : italic ? "italic" : "normal";
        const font = `${fontStyle} ${fontSizePx}px ${fontFamily}`;
        const segLineH = Math.max(14, fontSizePx * 1.25);
        let i = 0;
        while (i < t.length) {
          const ch = t[i]!;
          if (ch === "\n") {
            newLine();
            i += 1;
            continue;
          }
          const availableW = Math.max(1, maxW - cursorX);
          let j = i + 1;
          let best = i;
          while (j <= t.length) {
            const slice = t.slice(i, j);
            const wPx = measure(slice, font);
            if (wPx <= availableW) {
              best = j;
              j += 1;
              continue;
            }
            break;
          }
          if (best === i) {
            if (cursorX > 0) {
              newLine();
              continue;
            }
            best = i + 1;
          }
          const chunk = t.slice(i, best);
          cursorX += measure(chunk, font);
          lineH = Math.max(lineH, segLineH);
          i = best;
          if (cursorX >= maxW - 0.5) newLine();
        }
      }
      return cursorY + lineH;
    };

    const autoFitOverlayToContent = () => {
      try {
        const maxW = Math.max(1, ed.clientWidth - padPx * 2);
        const runs = this.activeTextEdit?.id === id ? (this.activeTextEdit.runs as any[]) : [];
        const textH = Math.max(EDIT_MIN_TEXT_H, Math.ceil(measureRunsHeightPx(runs, maxW)) + padPx * 2);
        const desiredH = Math.max(EDIT_MIN_H, TOPBAR_H + textH);
        overlay.style.height = `${desiredH}px`;
      } catch {
        /* ignore */
      }
    };
    autoFitOverlayToContent();

    const getRunStyleAtIndex = (runs: any[], index: number) => {
      const idx = Math.max(0, Number(index) || 0);
      let pos = 0;
      for (const r of runs || []) {
        const t = String(r?.text ?? "");
        const next = pos + t.length;
        if (idx < next) return r;
        pos = next;
      }
      return runs?.[runs.length - 1] ?? null;
    };

    const syncCaretStyle = () => {
      try {
        const idx = captureSelection().start ?? 0;
        const r = getRunStyleAtIndex(this.activeTextEdit?.runs as any, idx);
        if (!r) return;
        curColor = String(r.color || baseColor);
        fgColorInput.value = curColor;
        fgBtn.style.background = curColor;
        curFontSize = Math.max(10, Number(r.fontSize || baseFontSize));
        sizeInput.value = String(curFontSize);
        curBold = r.fontWeight === "bold";
        curItalic = !!r.italic;
        curUnderline = !!r.underline;
        setBtnActive(btnB, curBold);
        setBtnActive(btnI, curItalic);
        setBtnActive(btnU, curUnderline);
      } catch {
        /* ignore */
      }
    };
    ed.addEventListener("mouseup", syncCaretStyle);
    ed.addEventListener("keyup", syncCaretStyle as any);

    // input -> update runs (IME-safe; no DOM rebuild)
    const getEditorText = () => String((ed as any).innerText != null ? String((ed as any).innerText) : String(ed.textContent || "")).replace(/\r\n/g, "\n");
    let lastText = getEditorText();
    const commonPrefixLen = (a: string, b: string) => {
      const n = Math.min(a.length, b.length);
      let i = 0;
      while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
      return i;
    };
    const commonSuffixLen = (a: string, b: string, prefix: number) => {
      let i = a.length - 1;
      let j = b.length - 1;
      let c = 0;
      while (i >= prefix && j >= prefix && a.charCodeAt(i) === b.charCodeAt(j)) {
        c++;
        i--;
        j--;
      }
      return c;
    };
    const spliceRuns = (runs: any[], start: number, end: number, insertText: string, insertStyle: any) => {
      const s = Math.max(0, Math.min(start, end));
      const e = Math.max(0, Math.max(start, end));
      const deleted: any[] = [];
      let pos = 0;
      for (const r of runs) {
        const t = String(r?.text ?? "");
        const len = t.length;
        const from = pos;
        const to = pos + len;
        pos = to;
        if (to <= s || from >= e) {
          deleted.push({ ...r });
          continue;
        }
        const leftCount = Math.max(0, s - from);
        const rightCount = Math.max(0, to - e);
        if (leftCount > 0) deleted.push({ ...r, text: t.slice(0, leftCount) });
        if (rightCount > 0) deleted.push({ ...r, text: t.slice(len - rightCount) });
      }
      if (!insertText) return normalizeTextRunsUtil({ runs: deleted, fallbackStyle: { color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight, italic: false, underline: false } });
      const out: any[] = [];
      let p = 0;
      let inserted = false;
      for (const r of deleted) {
        const t = String(r?.text ?? "");
        const len = t.length;
        if (!inserted && p + len >= s) {
          const cut = s - p;
          if (cut > 0) out.push({ ...r, text: t.slice(0, cut) });
          out.push({ ...insertStyle, text: insertText });
          if (cut < len) out.push({ ...r, text: t.slice(cut) });
          inserted = true;
        } else {
          out.push({ ...r });
        }
        p += len;
      }
      if (!inserted) out.push({ ...insertStyle, text: insertText });
      return normalizeTextRunsUtil({ runs: out, fallbackStyle: { color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight, italic: false, underline: false } });
    };

    const syncRunsFromDom = () => {
      if (!this.activeTextEdit || this.activeTextEdit.id !== id) return;
      const sel = captureSelection();
      const nextText = getEditorText();
      if (nextText === lastText) return;
      const prefix = commonPrefixLen(lastText, nextText);
      const suffix = commonSuffixLen(lastText, nextText, prefix);
      const oldMidEnd = lastText.length - suffix;
      const newMidEnd = nextText.length - suffix;
      const insert = nextText.slice(prefix, newMidEnd);
      const curStyle = { color: curColor, fontSize: curFontSize, fontWeight: curBold ? "bold" : "normal", italic: curItalic, underline: curUnderline };
      this.activeTextEdit.runs = spliceRuns(this.activeTextEdit.runs as any[], prefix, oldMidEnd, insert, curStyle) as any;
      lastText = nextText;
      autoFitOverlayToContent();
      syncCaretStyle();
      restoreSelection(sel);
    };

    ed.addEventListener("input", () => {
      if (isComposing) return;
      syncRunsFromDom();
    });

    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (overlay.contains(t)) return;
      commit();
    };
    window.addEventListener("mousedown", onDocMouseDown, { capture: true });

    const cleanup = () => {
      try {
        window.removeEventListener("mousedown", onDocMouseDown, true as any);
      } catch {
        /* ignore */
      }
      try {
        overlay.remove();
      } catch {
        /* ignore */
      }
      if (this.textEditingInput === ed) this.textEditingInput = null;
      if (this.textEditingOverlay === overlay) this.textEditingOverlay = null;
      // ensure underlying annotation is visible again if commit didn't restore
      restoreUnderlying();
    };

    const commit = () => {
      const rawFull = getEditorText();
      const rawTrim = rawFull.trim();
      if (!rawTrim) {
        this.recordUndo([pageNum], () => {
          const idx = (this.annotations[pageNum] || []).findIndex((a) => a.id === id);
          if (idx >= 0) this.annotations[pageNum].splice(idx, 1);
          const g = this.getOrCreatePageGroup(pageNum);
          g.findOne(`#${id}`)?.destroy();
        });
        this.contentLayer?.batchDraw();
        cleanup();
        this.activeTextEdit = null;
        this.setMode("none");
        return;
      }

      const currentRuns = (() => {
        const r = this.activeTextEdit?.id === id ? this.activeTextEdit.runs : null;
        if (!r) return normalizeTextRunsUtil({ runs: [{ text: rawFull, color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight, italic: baseItalic, underline: baseUnderline }], fallbackStyle: { color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight, italic: false, underline: false } });
        const runsText = r.map((x) => x.text).join("");
        if (runsText !== rawFull) {
          return normalizeTextRunsUtil({ runs: [{ text: rawFull, color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight, italic: baseItalic, underline: baseUnderline }], fallbackStyle: { color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight, italic: false, underline: false } });
        }
        return r;
      })();

      const bb = overlay.getBoundingClientRect();
      this.recordUndo([pageNum], () => {
        ann.data = {
          ...data,
          v: 2,
          kind: "textbox",
          text: rawFull,
          runs: (currentRuns as any[]).map((r) => ({
            text: r.text,
            color: r.color,
            fontWeight: r.fontWeight,
            italic: !!r.italic,
            underline: !!r.underline,
            fontSizeNorm: (r.fontSize || baseFontSize) / pageH,
          })),
          widthNorm: Math.min(0.95, Math.max(120, bb.width) / pageW),
          heightNorm: Math.min(0.95, Math.max(60, bb.height - TOPBAR_H) / pageH),
          fontFamily: String(data.fontFamily || "Arial"),
          fontSizeNorm: baseFontSize / pageH,
          color: baseColor,
          fontWeight: baseWeight,
          italic: baseItalic,
          underline: baseUnderline,
        };
        const g = this.getOrCreatePageGroup(pageNum);
        const box = g.findOne(`#${id}`) as Konva.Group | null;
        if (box && box instanceof Konva.Group) {
          try {
            box.stopDrag?.();
            box.draggable(true);
          } catch {
            /* ignore */
          }
          const rect = box.findOne(".textbox-rect") as Konva.Rect | null;
          if (rect) {
            rect.width(Math.max(120, bb.width));
            rect.height(Math.max(60, bb.height - TOPBAR_H));
            if (typeof ann.data.bgColor === "string") rect.fill(ann.data.bgColor);
          }
          this.renderTextboxRuns({
            box,
            pageNum,
            pageW,
            pageH,
            data: ann.data,
            w: Math.max(120, bb.width),
            h: Math.max(60, bb.height - TOPBAR_H),
            pad: padPx,
          });
        }
      });
      // show underlying annotation again now that we've updated it
      restoreUnderlying();
      this.contentLayer?.batchDraw();
      cleanup();
      this.activeTextEdit = null;
      this.setMode("none");
    };

    ed.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        // Force newline insertion (some contenteditable setups don't insert a visible newline).
        if (isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          const sel = window.getSelection?.();
          if (sel && sel.rangeCount > 0) {
            const r = sel.getRangeAt(0);
            if (ed.contains(r.startContainer) && ed.contains(r.endContainer)) {
              r.deleteContents();
              const br = document.createElement("br");
              r.insertNode(br);
              // place caret after <br>
              r.setStartAfter(br);
              r.setEndAfter(br);
              sel.removeAllRanges();
              sel.addRange(r);
              // Add a zero-width space to ensure caret stays on a new line in some browsers
              const zw = document.createTextNode("\u200B");
              r.insertNode(zw);
              r.setStartAfter(zw);
              r.setEndAfter(zw);
              sel.removeAllRanges();
              sel.addRange(r);
            }
          }
        } catch {
          /* ignore */
        }
        try {
          syncRunsFromDom();
        } catch {
          /* ignore */
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        commit();
      }
    });
  }

}

