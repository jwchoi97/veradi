import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import Konva from "konva";
import { getAuthedUser } from "@/auth";
import { KonvaAnnotationManager } from "@/pdfjs-viewer/main";
import { attachTouchGestures } from "@/pdfjs-viewer/core/input/touchGestures";

// Worker 설정
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
  Konva.pixelRatio = Math.max(1, (window.devicePixelRatio || 1));
}

// NOTE:
// We intentionally do NOT import `./PdfJsKonvaViewer.css` because this project frequently
// deletes/moves that file during iteration, and Vite will hard-fail on missing CSS imports.
// These styles are injected inline to keep the viewer working even if the CSS file is absent.
const PDF_JS_KONVA_VIEWER_CSS = `
.pdf-viewer-toolbar{position:sticky;top:0;left:0;z-index:50;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 10px;background:#111827;color:#f9fafb;border-bottom:1px solid rgba(255,255,255,.08)}
.pdf-viewer-toolbar .group{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.pdf-viewer-toolbar .group.right{justify-content:flex-end}
.pdf-viewer-toolbar .btn{appearance:none;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;height:32px;min-width:32px;padding:0 10px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;font-size:13px;line-height:1}
.pdf-viewer-toolbar .btn:hover{background:rgba(255,255,255,.12)}
.pdf-viewer-toolbar .btn:disabled{opacity:.5;cursor:default}
.pdf-viewer-toolbar .btn.active{border-color:rgba(99,102,241,.9);background:rgba(99,102,241,.18)}
.pdf-viewer-toolbar .inp{width:70px;height:32px;padding:0 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#f9fafb}
.pdf-viewer-toolbar .hint{font-size:12px;opacity:.85;padding:0 4px}
.pdf-viewer-toolbar .sep{display:inline-block;width:1px;height:22px;margin:0 4px;background:rgba(255,255,255,.16)}
.pdf-viewer-toolbar .btnbox{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);border-radius:8px;overflow:hidden}
.pdf-viewer-toolbar .btnbox .segbtn{appearance:none;border:0;background:transparent;color:inherit;height:32px;min-width:32px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;font-size:13px;line-height:1}
.pdf-viewer-toolbar .btnbox .segbtn:hover{background:rgba(255,255,255,.12)}
.pdf-viewer-toolbar .btnbox .segbtn.active{background:rgba(99,102,241,.18)}
.pdf-viewer-toolbar .btnbox .segdiv{width:1px;height:22px;background:rgba(255,255,255,.14)}
.pdf-viewer-toolbar .spinbox{display:inline-flex;flex-direction:column;border:1px solid rgba(148,163,184,.35);background:rgba(107,114,128,.18);border-radius:10px;overflow:hidden}
.pdf-viewer-toolbar .spinbtn{appearance:none;border:0;background:rgba(107,114,128,.22);color:rgba(243,244,246,.92);height:15px;min-width:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;font-size:10px}
.pdf-viewer-toolbar .spinbtn:hover{background:rgba(107,114,128,.32)}
.pdf-viewer-toolbar .spinsep{width:100%;height:1px;background:rgba(148,163,184,.28)}
.pdf-viewer-main{position:relative;flex:1 1 auto;min-height:0}
.pdf-viewer-xscroll{width:100%;height:100%;overflow-x:auto;overflow-y:visible;overscroll-behavior:contain}
.pdf-viewer-container{width:100%}
.pdf-viewer-viewer{position:relative}
.pdf-viewer-tool-settings{position:fixed;width:260px;background:#0b1220;color:#f9fafb;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 10px 12px;z-index:80;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.pdf-viewer-tool-settings .row{display:flex;align-items:center;gap:10px;margin-top:10px}
.pdf-viewer-tool-settings .row:first-child{margin-top:0}
.pdf-viewer-tool-settings .label{width:44px;font-size:12px;opacity:.9}
.pdf-viewer-tool-settings .swatches{display:flex;align-items:center;gap:8px}
.pdf-viewer-tool-settings .swatch{width:22px;height:22px;border-radius:999px;border:2px solid rgba(255,255,255,.35);cursor:pointer}
.pdf-viewer-tool-settings .swatch.active{border-color:rgba(99,102,241,1);box-shadow:0 0 0 3px rgba(99,102,241,.25)}
.pdf-viewer-tool-settings .range{flex:1 1 auto}
.pdf-viewer-tool-settings .num{width:64px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#f9fafb;padding:0 8px}
.pdf-viewer-tool-settings .pct{width:56px;text-align:right;font-variant-numeric:tabular-nums;opacity:.9}
`;

// KonvaAnnotationManager와 관련 타입들을 main.ts에서 가져와야 하지만,
// 일단 간단한 버전으로 시작하고 점진적으로 확장

export type PdfJsKonvaViewerProps = {
  fileUrl: string;
  fileId: number;
  fileName?: string | null;
  reviewStatus?: string | null;
  fullscreen?: boolean;
  onFullscreenChange?: (enabled: boolean) => void;
  onStartReview?: () => void;
  onStopReview?: () => void;
};

export default function PdfJsKonvaViewer({
  fileUrl,
  fileId,
  fileName = null,
  reviewStatus = null,
  fullscreen = false,
  onFullscreenChange,
  onStartReview,
  onStopReview,
}: PdfJsKonvaViewerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoomPct, setZoomPct] = useState(100);
  const [currentMode, setCurrentMode] = useState<"none" | "ink" | "highlight" | "freetext" | "eraser">("none");
  const [saving, setSaving] = useState(false);
  const [docReady, setDocReady] = useState(false);

  // Page input: keep a local draft so typing/spinner changes can be applied reliably.
  const [pageInput, setPageInput] = useState<string>("1");
  const pageInputFocusedRef = useRef(false);
  const pendingApplyPageTimerRef = useRef<number | null>(null);
  const pendingScrollSyncRafRef = useRef<number | null>(null);
  const currentPageRef = useRef<number>(1);

  // tool settings (match previous viewer behavior)
  const [openSettings, setOpenSettings] = useState<null | "ink" | "highlight">(null);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const inkBtnRef = useRef<HTMLButtonElement | null>(null);
  const highlightBtnRef = useRef<HTMLButtonElement | null>(null);
  const [settingsPos, setSettingsPos] = useState<{ left: number; top: number }>({ left: 10, top: 52 });

  const [inkPalette, setInkPalette] = useState<string[]>(["#111827", "#dc2626", "#2563eb", "#16a34a", "#f59e0b"]);
  const [inkPaletteIdx, setInkPaletteIdx] = useState(0);
  const [inkWidth, setInkWidth] = useState(2);

  const [highlightPalette, setHighlightPalette] = useState<string[]>(["#FFF066", "#A7F3D0", "#BFDBFE", "#FBCFE8", "#FDE68A"]);
  const [highlightPaletteIdx, setHighlightPaletteIdx] = useState(0);
  const [highlightOpacity, setHighlightOpacity] = useState(0.45);

  const inkColor = inkPalette[inkPaletteIdx] || "#111827";
  const highlightColor = highlightPalette[highlightPaletteIdx] || "#FFF066";

  const inkColorPickerRef = useRef<HTMLInputElement | null>(null);
  const highlightColorPickerRef = useRef<HTMLInputElement | null>(null);

  // Textbox styling UI is now rendered inside the edit overlay (engine-owned).

  const eventBus = useMemo(() => new EventBus(), []);
  const linkService = useMemo(() => new PDFLinkService({ eventBus }), [eventBus]);

  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<any>(null);
  const pageNumberInputRef = useRef<HTMLInputElement | null>(null);
  const annotationManagerRef = useRef<KonvaAnnotationManager | null>(null);

  // Zoom clamp (50% ~ 300%)
  const clampScale = useCallback((n: number) => Math.min(3, Math.max(0.5, n)), []);

  // Zoom/relayout performance: coalesce expensive work
  const pendingSyncRafRef = useRef<number | null>(null);
  const pendingHeavySyncTimerRef = useRef<number | null>(null);
  const pendingHeightRafRef = useRef<number | null>(null);
  const scheduleUpdateContainerHeightRef = useRef<(() => void) | null>(null);
  const lastScaleChangeAtRef = useRef<number>(0);

  // Horizontal centering (canvas centered inside its scroll wrapper)
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const scrollParentYRef = useRef<HTMLElement | null>(null);
  const ignoreNextScrollRef = useRef(false);
  const userScrolledHorizRef = useRef(false);

  const isScrollableY = useCallback((el: HTMLElement | null): boolean => {
    if (!el) return false;
    try {
      const style = window.getComputedStyle(el);
      const ov = style.overflowY;
      const isScrollableStyle =
        ov === "auto" ||
        ov === "scroll" ||
        el.classList.toString().includes("overflow-y-auto") ||
        el.classList.toString().includes("overflow-y-scroll");
      if (!isScrollableStyle) return false;
      return el.scrollHeight > el.clientHeight + 2;
    } catch {
      return false;
    }
  }, []);

  const getScrollParentX = useCallback((): HTMLElement | null => {
    if (scrollParentRef.current) return scrollParentRef.current;
    const start = containerRef.current;
    if (!start) return null;
    let el: HTMLElement | null = start.parentElement as HTMLElement | null;
    while (el) {
      const style = window.getComputedStyle(el);
      const ov = style.overflowX;
      if (
        ov === "auto" ||
        ov === "scroll" ||
        el.classList.toString().includes("overflow-x-auto") ||
        el.classList.toString().includes("overflow-x-scroll")
      ) {
        scrollParentRef.current = el;
        return el;
      }
      el = el.parentElement as HTMLElement | null;
    }
    return null;
  }, []);

  const getScrollParentY = useCallback((): HTMLElement | null => {
    // Validate cached scroll parent; if it is no longer scrollable, re-detect.
    if (scrollParentYRef.current && isScrollableY(scrollParentYRef.current)) return scrollParentYRef.current;
    scrollParentYRef.current = null;
    const start = containerRef.current;
    if (!start) return document.scrollingElement as HTMLElement | null;
    let el: HTMLElement | null = start.parentElement as HTMLElement | null;
    while (el) {
      if (isScrollableY(el)) {
        scrollParentYRef.current = el;
        return el;
      }
      el = el.parentElement as HTMLElement | null;
    }
    // Do not cache scrollingElement (SPA layouts often scroll inside a div).
    return document.scrollingElement as HTMLElement | null;
  }, [isScrollableY]);

  const centerCanvasInWrapper = useCallback(
    (opts?: { force?: boolean }) => {
      const sp = getScrollParentX();
      if (!sp) return;
      if (!opts?.force && userScrolledHorizRef.current) return;
      const maxLeft = Math.max(0, sp.scrollWidth - sp.clientWidth);
      if (maxLeft <= 0) return;

      // Prefer centering based on the actual visual content (canvasWrapper/canvas),
      // not scrollWidth (Konva overlay can inflate scrollWidth).
      const root = viewerRef.current;
      const targetEl =
        (root?.querySelector?.(".page .canvasWrapper") as HTMLElement | null) ||
        (root?.querySelector?.(".page canvas") as HTMLElement | null);

      let targetScrollLeft: number | null = null;
      if (targetEl) {
        const spBox = sp.getBoundingClientRect();
        const tBox = targetEl.getBoundingClientRect();
        const tCenterX = (tBox.left - spBox.left) + sp.scrollLeft + tBox.width / 2;
        targetScrollLeft = Math.round(tCenterX - sp.clientWidth / 2);
      } else {
        targetScrollLeft = Math.round(maxLeft / 2);
      }

      const target = Math.min(maxLeft, Math.max(0, targetScrollLeft ?? 0));
      ignoreNextScrollRef.current = true;
      sp.scrollLeft = target;
      // release in next tick (avoid marking as user scroll)
      window.setTimeout(() => {
        ignoreNextScrollRef.current = false;
      }, 0);
    },
    [getScrollParentX]
  );

  // PDFViewer 초기화 (한 번만)
  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer) return;

    // PDF.js 요구사항: container는 absolute여야 함
    // 하지만 부모 스크롤을 위해 wrapper를 relative로 설정
    container.style.position = "absolute";
    container.style.inset = "0";
    container.style.overflow = "visible"; // 내부 스크롤 제거
    container.style.padding = "16px";
    container.style.background = "#374151";

    // Ctrl/Meta + wheel: 줌 처리
    // Shift + wheel: 가로 스크롤(바깥 스크롤 컨테이너 scrollLeft 이동)
    // 그 외 wheel은 기본 스크롤(바깥 스크롤바)을 막지 않는다.
    const handleWheel = (e: WheelEvent) => {
      const getFactor = () => (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);

      // Shift+wheel => horizontal pan (even if overflow-x scrollbar is hidden)
      if (!e.ctrlKey && !e.metaKey && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
        const dx = (Math.abs(e.deltaX) > 0 ? e.deltaX : e.deltaY) * factor;
        let parentEl: HTMLElement | null = container.parentElement;
        while (parentEl) {
          const style = window.getComputedStyle(parentEl);
          if (
            style.overflowX === "auto" ||
            style.overflowX === "scroll" ||
            parentEl.classList.toString().includes("overflow-x-auto") ||
            parentEl.classList.toString().includes("overflow-x-scroll")
          ) {
            parentEl.scrollLeft += dx;
            break;
          }
          parentEl = parentEl.parentElement;
        }
        return;
      }

      // Normal wheel => always drive the OUTER vertical scrollbar.
      // This makes wheel scrolling work even when the pointer is over canvas/overlay elements.
      if (!e.ctrlKey && !e.metaKey) {
        const factor = getFactor();
        const dy = (e.deltaY || 0) * factor;
        if (dy === 0) return;
        e.preventDefault();
        e.stopPropagation();

        let parentEl: HTMLElement | null = container.parentElement;
        while (parentEl) {
          const style = window.getComputedStyle(parentEl);
          const ov = style.overflowY;
          const isScrollableStyle =
            ov === "auto" ||
            ov === "scroll" ||
            parentEl.classList.toString().includes("overflow-y-auto") ||
            parentEl.classList.toString().includes("overflow-y-scroll");
          if (isScrollableStyle && parentEl.scrollHeight > parentEl.clientHeight + 2) {
            parentEl.scrollTop += dy;
            return;
          }
          parentEl = parentEl.parentElement;
        }
        const se = document.scrollingElement as HTMLElement | null;
        if (se && se.scrollHeight > se.clientHeight + 2) se.scrollTop += dy;
        return;
      }

      // Ctrl/Meta+wheel => zoom
      e.preventDefault();
      e.stopPropagation();
      const pdfViewer = pdfViewerRef.current;
      if (!pdfViewer) return;
      // wheel up: zoom in, wheel down: zoom out (use explicit clamp; don't let pdf.js overshoot then "snap back")
      const cur = Number(pdfViewer.currentScale || 1);
      const next = e.deltaY < 0 ? cur * 1.1 : cur / 1.1;
      pdfViewer.currentScale = clampScale(next);
    };
    container.addEventListener("wheel", handleWheel, { passive: false });

    // track user horizontal scroll so we don't fight them
    const sp = getScrollParentX();
    const onScroll = () => {
      if (ignoreNextScrollRef.current) return;
      // any non-zero scrollLeft means user panned horizontally at least once
      if (sp && sp.scrollLeft !== 0) userScrolledHorizRef.current = true;
    };
    if (sp) sp.addEventListener("scroll", onScroll, { passive: true });

    const pdfViewer = new PDFViewer({
      container,
      viewer,
      eventBus,
      linkService,
      annotationMode: (pdfjsLib as any).AnnotationMode.DISABLE,
    });

    pdfViewerRef.current = pdfViewer;
    linkService.setViewer(pdfViewer);

    // 컨테이너 높이를 콘텐츠에 맞춰서 부모 스크롤이 작동하도록
    const updateContainerHeight = () => {
      if (!container || !viewer) return;
      const scrollHeight = Math.max(viewer.scrollHeight, container.scrollHeight);
      // wrapper의 높이를 조정하여 부모가 스크롤할 수 있도록
      const wrapper = container.parentElement;
      if (wrapper) {
        wrapper.style.height = `${scrollHeight}px`;
        wrapper.style.minHeight = "100%";
      }
    };
    const scheduleHeight = () => {
      if (pendingHeightRafRef.current !== null) return;
      pendingHeightRafRef.current = window.requestAnimationFrame(() => {
        pendingHeightRafRef.current = null;
        updateContainerHeight();
      });
    };
    scheduleUpdateContainerHeightRef.current = scheduleHeight;

    const runHeavySync = () => {
      if (pendingSyncRafRef.current !== null) return;
      pendingSyncRafRef.current = window.requestAnimationFrame(() => {
        pendingSyncRafRef.current = null;
        try {
          annotationManagerRef.current?.updatePagesFromPdfLayout?.({ padding: 16, gap: 14 });
        } catch {
          /* ignore */
        }
        try {
          centerCanvasInWrapper();
        } catch {
          /* ignore */
        }
        scheduleHeight();
      });
    };

    const scheduleHeavySync = (delayMs: number) => {
      if (pendingHeavySyncTimerRef.current !== null) {
        window.clearTimeout(pendingHeavySyncTimerRef.current);
      }
      pendingHeavySyncTimerRef.current = window.setTimeout(() => {
        pendingHeavySyncTimerRef.current = null;
        runHeavySync();
      }, delayMs);
    };

    const onPagesInit = () => {
      try {
        pdfViewer.currentScaleValue = "page-width";
        setTotalPages(pdfViewer.pagesCount || pdfDocRef.current?.numPages || 0);
        setCurrentPage(pdfViewer.currentPageNumber || 1);
        setZoomPct(Math.round((pdfViewer.currentScale || 1) * 100));
      } catch {
        /* ignore */
      }
      // 초기 렌더 직후 1회만 무거운 동기화
      try {
        userScrolledHorizRef.current = false;
        centerCanvasInWrapper({ force: true });
      } catch {
        /* ignore */
      }
      runHeavySync();
    };
    
    const onPageChange = (e: any) => {
      // pdf.js emits `pageNumber` (not `page`) for "pagechanging"
      const raw = e?.pageNumber ?? e?.page ?? e?.pageNum;
      const next = Number(raw);
      if (Number.isFinite(next) && next > 0) {
        currentPageRef.current = next;
        setCurrentPage(next);
        if (!pageInputFocusedRef.current) setPageInput(String(next));
        return;
      }
      // Fallback: keep existing state (avoid flashing to 1)
    };
    
    const onScaleChange = (e: any) => {
      lastScaleChangeAtRef.current = performance.now();
      const scale = typeof e?.scale === "number" ? e.scale : (pdfViewer.currentScale || 1);
      const clamped = clampScale(scale);
      setZoomPct(Math.round(clamped * 100));
      // ✅ If anything pushed scale out of bounds (e.g. built-in steps), correct after this tick
      if (Number.isFinite(clamped)) {
        setTimeout(() => {
          try {
            const cur = Number(pdfViewer.currentScale || 1);
            const c = clampScale(cur);
            if (c !== cur) pdfViewer.currentScale = c;
          } catch {
            /* ignore */
          }
        }, 0);
      }
      // 줌 중에는 무거운 작업을 매 tick마다 하지 말고, 잠깐 멈췄을 때 1회 수행
      scheduleHeight();
      scheduleHeavySync(90);
    };
    
    eventBus.on("pagesinit", onPagesInit);
    eventBus.on("pagechanging", onPageChange);
    eventBus.on("scalechanging", onScaleChange);
    eventBus.on("pagerendered", () => {
      // 렌더 이벤트는 매우 자주 발생할 수 있으므로 높이만 빠르게 갱신하고,
      // 줌 직후에는 scalechanging에서 디바운스로 처리한다.
      scheduleHeight();
      if (performance.now() - lastScaleChangeAtRef.current > 250) {
        scheduleHeavySync(0);
      }
    });

    // 리사이즈 옵저버로 높이 추적
    const resizeObserver = new ResizeObserver(() => {
      scheduleHeight();
    });
    resizeObserver.observe(viewer);

    // PDFViewer 초기화 완료 표시
    setViewerReady(true);

    return () => {
      if (pendingHeightRafRef.current !== null) {
        window.cancelAnimationFrame(pendingHeightRafRef.current);
        pendingHeightRafRef.current = null;
      }
      if (pendingSyncRafRef.current !== null) {
        window.cancelAnimationFrame(pendingSyncRafRef.current);
        pendingSyncRafRef.current = null;
      }
      if (pendingHeavySyncTimerRef.current !== null) {
        window.clearTimeout(pendingHeavySyncTimerRef.current);
        pendingHeavySyncTimerRef.current = null;
      }
      scheduleUpdateContainerHeightRef.current = null;
      eventBus.off("pagesinit", onPagesInit);
      eventBus.off("pagechanging", onPageChange);
      eventBus.off("scalechanging", onScaleChange);
      container.removeEventListener("wheel", handleWheel);
      if (sp) sp.removeEventListener("scroll", onScroll as any);
      resizeObserver.disconnect();
      try {
        pdfViewerRef.current?.setDocument(null as any);
      } catch {
        // ignore
      }
      try {
        annotationManagerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      annotationManagerRef.current = null;
      pdfViewerRef.current = null;
      setViewerReady(false);
    };
  }, [eventBus, linkService, clampScale, centerCanvasInWrapper, getScrollParentX]);

  // PDF 로드 (PDFViewer 초기화 완료 후)
  useEffect(() => {
    if (!viewerReady || !pdfViewerRef.current || !fileUrl) return;
    
    let cancelled = false;
    // Abort any previous in-flight load (prevents duplicate downloads/parsing).
    try {
      loadingTaskRef.current?.destroy?.();
    } catch {
      /* ignore */
    }
    loadingTaskRef.current = null;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setDocReady(false);
      try {
        const me = getAuthedUser();
        const headers: Record<string, string> = {};
        if (typeof me?.id === "number") headers["X-User-Id"] = String(me.id);

        console.log("Loading PDF from:", fileUrl);
        const task = pdfjsLib.getDocument({
          url: fileUrl,
          httpHeaders: headers,
          withCredentials: true,
          // Reduce request churn (especially over high-latency links) while still enabling range loading.
          // 1MB is a good balance for PDFs served via our proxy.
          rangeChunkSize: 1024 * 1024,
        });
        loadingTaskRef.current = task;
        const pdfDocument = await task.promise;
        if (cancelled) return;

        console.log("PDF loaded, setting document...");
        pdfDocRef.current = pdfDocument;
        linkService.setDocument(pdfDocument);
        pdfViewerRef.current?.setDocument(pdfDocument);
        console.log("PDF document set successfully");
        setDocReady(true);
      } catch (e: any) {
        console.error("Failed to load PDF", e);
        if (!cancelled) {
          setLoadError(e?.message || "PDF 로딩 실패");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      try {
        // Ensure network/worker is actually cancelled.
        (loadingTaskRef.current as any)?.destroy?.();
      } catch {
        /* ignore */
      }
      loadingTaskRef.current = null;
    };
  }, [fileUrl, viewerReady, linkService]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (pendingApplyPageTimerRef.current !== null) {
        window.clearTimeout(pendingApplyPageTimerRef.current);
        pendingApplyPageTimerRef.current = null;
      }
    };
  }, []);

  // Keep page input in sync with the actual current page (unless user is actively typing).
  useEffect(() => {
    currentPageRef.current = currentPage;
    if (pageInputFocusedRef.current) return;
    setPageInput(String(currentPage || 1));
  }, [currentPage]);

  // When vertical scrolling is handled by the OUTER container, pdf.js won't automatically
  // update the current page. So we compute the page in view based on DOM geometry and
  // sync state/input (and pdfViewer.currentPageNumber for internal consistency).
  useEffect(() => {
    if (!viewerReady) return;
    const computeVisiblePage = () => {
      const pv = pdfViewerRef.current;
      const root = viewerRef.current;
      if (!pv || !root) return;

      const sp = getScrollParentY();
      if (!sp) return;

      const toolbarEl = rootRef.current?.querySelector?.(".pdf-viewer-toolbar") as HTMLElement | null;
      const toolbarH = toolbarEl?.getBoundingClientRect?.().height || 0;
      const margin = 6;
      const spBox = sp.getBoundingClientRect();
      const topLine = spBox.top + toolbarH + margin;

      const pages = Array.from(root.querySelectorAll(".page")) as HTMLElement[];
      if (pages.length === 0) return;

      let chosen: number | null = null;
      let bestTop: number | null = null;

      for (const el of pages) {
        const rect = el.getBoundingClientRect();
        // Page that intersects the "top line" wins.
        if (rect.top <= topLine && rect.bottom > topLine) {
          const n = Number(el.getAttribute("data-page-number") || "");
          if (Number.isFinite(n) && n > 0) {
            chosen = n;
            break;
          }
        }
        // Otherwise, choose the first page below the top offset.
        if (rect.top > topLine) {
          if (bestTop === null || rect.top < bestTop) {
            bestTop = rect.top;
            const n = Number(el.getAttribute("data-page-number") || "");
            if (Number.isFinite(n) && n > 0) chosen = n;
          }
        }
      }

      if (chosen === null) {
        // Fallback: last page (e.g. scrolled past everything due to layout edge cases)
        const last = pages[pages.length - 1];
        const n = Number(last?.getAttribute("data-page-number") || "");
        if (Number.isFinite(n) && n > 0) chosen = n;
      }
      if (chosen === null) return;

      // Update state/UI only when it actually changes.
      if (chosen !== currentPageRef.current) {
        setCurrentPage(chosen);
      }
      if (!pageInputFocusedRef.current) setPageInput(String(chosen));

      // Keep pdf.js internal state consistent (doesn't scroll here, just updates selection/events).
      try {
        if (pv.currentPageNumber !== chosen) pv.currentPageNumber = chosen;
      } catch {
        /* ignore */
      }
    };

    const onScroll = () => {
      if (pendingScrollSyncRafRef.current !== null) return;
      pendingScrollSyncRafRef.current = window.requestAnimationFrame(() => {
        pendingScrollSyncRafRef.current = null;
        computeVisiblePage();
      });
    };

    // Capture scroll events from ANY scroll container (scroll doesn't bubble).
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    // Initial sync
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll as any, true as any);
      if (pendingScrollSyncRafRef.current !== null) {
        window.cancelAnimationFrame(pendingScrollSyncRafRef.current);
        pendingScrollSyncRafRef.current = null;
      }
    };
  }, [viewerReady, getScrollParentY]);

  const scrollOuterToPageTop = useCallback(
    (pageNum: number) => {
      const pv = pdfViewerRef.current;
      if (!pv) return;

      const sp = getScrollParentY();
      if (!sp) return;

      const pageView = pv.getPageView?.(pageNum - 1) as any;
      const pageEl =
        ((pageView?.div || pageView?.container) as HTMLElement | undefined) ||
        (viewerRef.current?.querySelector?.(`.page[data-page-number="${pageNum}"]`) as HTMLElement | null) ||
        undefined;
      if (!pageEl) return;

      const spBox = sp.getBoundingClientRect();
      const pBox = pageEl.getBoundingClientRect();

      // Sticky toolbar can cover the top of the page; offset by its height.
      const toolbarEl = rootRef.current?.querySelector?.(".pdf-viewer-toolbar") as HTMLElement | null;
      const toolbarH = toolbarEl?.getBoundingClientRect?.().height || 0;
      const margin = 6;

      const delta = pBox.top - spBox.top;
      const next = Math.max(0, Math.round(sp.scrollTop + delta - toolbarH - margin));
      sp.scrollTop = next;
    },
    [getScrollParentY]
  );

  const applyPageNumber = useCallback(
    (raw: string) => {
      if (!pdfViewerRef.current || !pdfDocRef.current) return;
      if (raw.trim() === "") return;
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      const pageNum = Math.max(1, Math.min(pdfDocRef.current.numPages, Math.trunc(n) || 1));
      pdfViewerRef.current.currentPageNumber = pageNum;
      setCurrentPage(pageNum);
      // In this viewer, vertical scrolling is delegated to the OUTER scroll container.
      // So, manually align the selected page's top to the visible top.
      try {
        // Allow pdf.js to update layout before measuring.
        requestAnimationFrame(() => {
          scrollOuterToPageTop(pageNum);
          // Retry shortly in case the page wasn't laid out yet.
          window.setTimeout(() => scrollOuterToPageTop(pageNum), 50);
        });
      } catch {
        /* ignore */
      }
    },
    [scrollOuterToPageTop]
  );

  const scheduleApplyPageNumber = useCallback(
    (raw: string, delayMs = 200) => {
      if (pendingApplyPageTimerRef.current !== null) {
        window.clearTimeout(pendingApplyPageTimerRef.current);
        pendingApplyPageTimerRef.current = null;
      }
      pendingApplyPageTimerRef.current = window.setTimeout(() => {
        pendingApplyPageTimerRef.current = null;
        applyPageNumber(raw);
      }, delayMs);
    },
    [applyPageNumber]
  );

  // KonvaAnnotationManager 초기화/연동
  useEffect(() => {
    if (!viewerReady || !docReady) return;
    const container = containerRef.current;
    const pdfViewer = pdfViewerRef.current;
    const pdfDoc = pdfDocRef.current;
    const me = getAuthedUser();
    if (!container || !pdfViewer || !pdfDoc || typeof me?.id !== "number") return;

    let disposed = false;
    let cleanupFns: Array<() => void> = [];
    (async () => {
      try {
        // 기존 매니저 정리
        try { annotationManagerRef.current?.destroy?.(); } catch { /* ignore */ }
        annotationManagerRef.current = null;

        const mgr = new KonvaAnnotationManager(container, pdfViewer as any, pdfDoc as any, String(fileId), String(me.id));
        annotationManagerRef.current = mgr;
        // Subscribe to engine events (preferred over legacy callbacks).
        cleanupFns.push(
          mgr.on("modeChanged", (mode: any) => {
            setCurrentMode(mode);
          })
        );
        // (Textbox edit overlay UI is engine-owned)
        await mgr.init();
        if (disposed) return;
        mgr.updatePagesFromPdfLayout({ padding: 16, gap: 14 });

        // Touch gestures (tablet): finger = scroll/pinch, pen/mouse = annotation interactions.
        // Attach to Konva stage container which sits above the PDF canvases.
        try {
          const stageEl = container.querySelector("#konva-stage-container") as HTMLElement | null;
          if (stageEl) {
            const detach = attachTouchGestures({
              element: stageEl,
              getScrollX: getScrollParentX,
              getScrollY: getScrollParentY,
              getScale: () => Number(pdfViewer.currentScale || 1),
              setScale: (next) => {
                pdfViewer.currentScale = clampScale(next);
              },
              clampScale,
            });
            cleanupFns.push(detach);
          }
        } catch {
          /* ignore */
        }
      } catch (e) {
        console.error("Failed to init KonvaAnnotationManager", e);
      }
    })();

    return () => {
      disposed = true;
      try {
        cleanupFns.forEach((fn) => fn());
      } catch {
        /* ignore */
      }
      cleanupFns = [];
    };
  }, [viewerReady, docReady, fileId, getScrollParentX, getScrollParentY, clampScale]);

  // 모드/툴 설정 반영
  useEffect(() => {
    try { annotationManagerRef.current?.setMode?.(currentMode as any); } catch { /* ignore */ }
  }, [currentMode]);

  useEffect(() => {
    try { annotationManagerRef.current?.setInkSettings?.({ color: inkColor, width: inkWidth }); } catch { /* ignore */ }
  }, [inkColor, inkWidth]);

  useEffect(() => {
    try { annotationManagerRef.current?.setHighlightSettings?.({ color: highlightColor }); } catch { /* ignore */ }
  }, [highlightColor]);

  useEffect(() => {
    try { annotationManagerRef.current?.setHighlightSettings?.({ opacity: highlightOpacity }); } catch { /* ignore */ }
  }, [highlightOpacity]);

  // Text styling is now handled per-textbox via the textbox toolbar (not global T settings).

  // 툴바 핸들러 (모든 hooks는 조건부 return 이전에 호출되어야 함)
  const handleZoomIn = useCallback(() => {
    if (!pdfViewerRef.current) return;
    const pv = pdfViewerRef.current;
    const cur = Number(pv.currentScale || 1);
    pv.currentScale = clampScale(cur * 1.1);
    try { requestAnimationFrame(() => centerCanvasInWrapper()); } catch { /* ignore */ }
  }, [clampScale, centerCanvasInWrapper]);

  const handleZoomOut = useCallback(() => {
    if (!pdfViewerRef.current) return;
    const pv = pdfViewerRef.current;
    const cur = Number(pv.currentScale || 1);
    pv.currentScale = clampScale(cur / 1.1);
    try { requestAnimationFrame(() => centerCanvasInWrapper()); } catch { /* ignore */ }
  }, [clampScale, centerCanvasInWrapper]);

  const handleFitWidth = useCallback(() => {
    if (!pdfViewerRef.current) return;
    pdfViewerRef.current.currentScaleValue = "page-width";
    const clamped = clampScale(pdfViewerRef.current.currentScale || 1);
    if (clamped !== pdfViewerRef.current.currentScale) {
      pdfViewerRef.current.currentScale = clamped;
    }
    // reset user horizontal scroll preference on fit-to-width
    userScrolledHorizRef.current = false;
    try { requestAnimationFrame(() => centerCanvasInWrapper({ force: true })); } catch { /* ignore */ }
  }, [clampScale, centerCanvasInWrapper]);

  const handleFitHeight = useCallback(() => {
    if (!pdfViewerRef.current || !containerRef.current) return;
    try {
      const pv = pdfViewerRef.current.getPageView?.((pdfViewerRef.current.currentPageNumber || 1) - 1);
      const vp = pv?.viewport;
      if (!vp || !vp.height) {
        pdfViewerRef.current.currentScaleValue = "page-height";
        return;
      }
      const cs = window.getComputedStyle(containerRef.current);
      const padTop = Number.parseFloat(cs.paddingTop || "0") || 0;
      const padBottom = Number.parseFloat(cs.paddingBottom || "0") || 0;
      const availH = Math.max(50, containerRef.current.clientHeight - padTop - padBottom);
      const curScale = Number(pdfViewerRef.current.currentScale || 1);
      const factor = availH / Number(vp.height);
      const nextScale = curScale * factor;
      if (Number.isFinite(nextScale) && nextScale > 0) {
        pdfViewerRef.current.currentScale = nextScale;
      } else {
        pdfViewerRef.current.currentScaleValue = "page-height";
      }
      const clamped = clampScale(pdfViewerRef.current.currentScale || 1);
      if (clamped !== pdfViewerRef.current.currentScale) {
        pdfViewerRef.current.currentScale = clamped;
      }
    } catch {
      pdfViewerRef.current.currentScaleValue = "page-height";
    }
    userScrolledHorizRef.current = false;
    try { requestAnimationFrame(() => centerCanvasInWrapper({ force: true })); } catch { /* ignore */ }
  }, [clampScale, centerCanvasInWrapper]);

  const handlePageNumberKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (pendingApplyPageTimerRef.current !== null) {
        window.clearTimeout(pendingApplyPageTimerRef.current);
        pendingApplyPageTimerRef.current = null;
      }
      applyPageNumber((e.currentTarget as HTMLInputElement).value);
      // After applying, reflect the actual current page (clamped) in the input.
      try {
        const cur = pdfViewerRef.current?.currentPageNumber;
        if (typeof cur === "number" && Number.isFinite(cur)) setPageInput(String(cur));
      } catch {
        /* ignore */
      }
    },
    [applyPageNumber]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // 1) Save annotations JSON (sidecar next to original PDF)
      await annotationManagerRef.current?.save?.();

      // 2) Bake JSON into a PDF and overwrite baked sidecar next to original.
      // This baked PDF is what the upload-page "검토상태" click opens (read-only).
      const me = getAuthedUser();
      const headers: Record<string, string> = {};
      if (typeof me?.id === "number") headers["X-User-Id"] = String(me.id);
      const res = await fetch(`/api/reviews/files/${fileId}/bake`, {
        method: "POST",
        headers,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Bake failed (${res.status})`);
      }
    } catch (err: any) {
      alert(err?.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  }, []);

  // 키보드 단축키
  useEffect(() => {
    if (!viewerReady) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const isMod = e.ctrlKey || e.metaKey;
      
      // 전체화면 닫기
      if (fullscreen && (e.key === "q" || e.key === "Q")) {
        e.preventDefault();
        onFullscreenChange?.(false);
        return;
      }

      // Undo/Redo (TODO: KonvaAnnotationManager 통합 후)
      if (isMod && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        e.preventDefault();
        try { annotationManagerRef.current?.undo?.(); } catch { /* ignore */ }
        return;
      }
      if (isMod && ((e.key === "y" || e.key === "Y") || ((e.key === "z" || e.key === "Z") && e.shiftKey))) {
        e.preventDefault();
        try { annotationManagerRef.current?.redo?.(); } catch { /* ignore */ }
        return;
      }

      // 선택 모드에서 Delete/Backspace로 선택 주석 삭제
      if ((e.key === "Delete" || e.key === "Backspace") && currentMode === "none") {
        e.preventDefault();
        try { annotationManagerRef.current?.deleteSelected?.(); } catch { /* ignore */ }
        return;
      }

      // 모드 전환
      if (e.key === "Escape") {
        setCurrentMode("none");
        try { annotationManagerRef.current?.setMode?.("none" as any); } catch { /* ignore */ }
      } else if (e.key === "i" || e.key === "I") {
        setCurrentMode("ink");
        try { annotationManagerRef.current?.setMode?.("ink" as any); } catch { /* ignore */ }
      } else if (e.key === "h" || e.key === "H") {
        setCurrentMode("highlight");
        try { annotationManagerRef.current?.setMode?.("highlight" as any); } catch { /* ignore */ }
      } else if (e.key === "t" || e.key === "T") {
        setCurrentMode("freetext");
        try { annotationManagerRef.current?.setMode?.("freetext" as any); } catch { /* ignore */ }
      } else if (e.key === "e" || e.key === "E") {
        setCurrentMode("eraser");
        try { annotationManagerRef.current?.setMode?.("eraser" as any); } catch { /* ignore */ }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewerReady, fullscreen, onFullscreenChange, currentMode]);

  // settings panel 위치 계산 + 바깥 클릭 시 닫기
  useEffect(() => {
    if (!openSettings) return;
    const anchor =
      openSettings === "ink"
        ? inkBtnRef.current
        : highlightBtnRef.current;
    const updatePos = () => {
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const margin = 8;
      const w = 260;
      const left = Math.max(margin, Math.min(window.innerWidth - w - margin, a.left));
      const top = Math.max(margin, Math.min(window.innerHeight - margin, a.bottom + 8));
      setSettingsPos({ left, top });
    };
    updatePos();
    window.addEventListener("scroll", updatePos, { passive: true, capture: true });
    window.addEventListener("resize", updatePos, { passive: true });

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (settingsPanelRef.current?.contains(target)) return;
      if (inkBtnRef.current?.contains(target as any)) return;
      if (highlightBtnRef.current?.contains(target as any)) return;
      setOpenSettings(null);
    };
    window.addEventListener("mousedown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("mousedown", onPointerDown, { capture: true } as any);
      window.removeEventListener("scroll", updatePos, true as any);
      window.removeEventListener("resize", updatePos as any);
    };
  }, [openSettings]);

  // 모드 변경 시 설정창 닫기 (툴 전환 UX)
  useEffect(() => {
    if (currentMode !== "ink" && currentMode !== "highlight") setOpenSettings(null);
  }, [currentMode]);

  const handleInkToolClick = useCallback(() => {
    if (currentMode === "ink") setOpenSettings((v) => (v === "ink" ? null : "ink"));
    else {
      setCurrentMode("ink");
      setOpenSettings(null);
      try { annotationManagerRef.current?.setMode?.("ink" as any); } catch { /* ignore */ }
    }
  }, [currentMode]);

  const handleHighlightToolClick = useCallback(() => {
    if (currentMode === "highlight") setOpenSettings((v) => (v === "highlight" ? null : "highlight"));
    else {
      setCurrentMode("highlight");
      setOpenSettings(null);
      try { annotationManagerRef.current?.setMode?.("highlight" as any); } catch { /* ignore */ }
    }
  }, [currentMode]);

  const handleTextToolClick = useCallback(() => {
    setCurrentMode("freetext");
    setOpenSettings(null);
    try { annotationManagerRef.current?.setMode?.("freetext" as any); } catch { /* ignore */ }
  }, []);

  // 조건부 렌더링은 모든 hooks 호출 후에만 수행
  if (loadError) {
    return (
      <div className="w-full bg-gray-50 relative flex flex-col" style={{ minHeight: "100%" }}>
        <div className="pdf-viewer-toolbar">
          <div className="group">
            <button className="btn" disabled>로딩 실패</button>
          </div>
        </div>
        <div className="pdf-viewer-main flex items-center justify-center">
          <span className="text-red-600">{loadError}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="w-full bg-gray-50 relative flex flex-col" style={{ minHeight: "100%" }}>
      <style>{PDF_JS_KONVA_VIEWER_CSS}</style>
      {/* 툴바 */}
      <div className="pdf-viewer-toolbar">
        <div className="group">
          <button
            className={`btn ${currentMode === "none" ? "active" : ""}`}
            onClick={() => setCurrentMode("none")}
            title="선택/이동(ESC)"
          >
            🖐
          </button>
          <button
            className={`btn ${currentMode === "ink" ? "active" : ""}`}
            ref={inkBtnRef}
            onClick={handleInkToolClick}
            title="펜(I)"
          >
            ✎
          </button>
          <button
            className={`btn ${currentMode === "highlight" ? "active" : ""}`}
            ref={highlightBtnRef}
            onClick={handleHighlightToolClick}
            title="형광펜(H)"
          >
            🖍
          </button>
          <button
            className={`btn ${currentMode === "freetext" ? "active" : ""}`}
            onClick={handleTextToolClick}
            title="텍스트(T)"
          >
            T
          </button>
          <button
            className={`btn ${currentMode === "eraser" ? "active" : ""}`}
            onClick={() => setCurrentMode("eraser")}
            title="지우개(E)"
          >
            ⌫
          </button>
          <button
            className="btn"
            onClick={() => { try { annotationManagerRef.current?.undo?.(); } catch { /* ignore */ } }}
            title="되돌리기(Ctrl+Z)"
          >
            ↶
          </button>
          <button
            className="btn"
            onClick={() => { try { annotationManagerRef.current?.redo?.(); } catch { /* ignore */ } }}
            title="다시하기(Ctrl+Y)"
          >
            ↷
          </button>
          <span className="sep"></span>
          <input
            ref={pageNumberInputRef}
            className="inp"
            type="number"
            min={1}
            max={Math.max(1, totalPages || 1)}
            value={pageInput}
            onFocus={() => {
              pageInputFocusedRef.current = true;
            }}
            onBlur={(e) => {
              pageInputFocusedRef.current = false;
              // Apply on blur so typed values also navigate even without Enter.
              if (pendingApplyPageTimerRef.current !== null) {
                window.clearTimeout(pendingApplyPageTimerRef.current);
                pendingApplyPageTimerRef.current = null;
              }
              applyPageNumber(e.currentTarget.value);
              // Sync input to the clamped/current page.
              setPageInput(String(pdfViewerRef.current?.currentPageNumber || currentPage || 1));
            }}
            onChange={(e) => {
              const raw = e.target.value;
              setPageInput(raw);
              // Apply after a short debounce so both typing and spinner controls work.
              scheduleApplyPageNumber(raw, 200);
            }}
            onKeyDown={handlePageNumberKeyDown}
            inputMode="numeric"
          />
          <span className="hint">/ {totalPages || "?"}</span>
          <span className="sep"></span>
          <button className="btn" title="확대율" style={{ minWidth: "64px", justifyContent: "center" }}>
            {zoomPct}%
          </button>
          <div className="spinbox" role="group" aria-label="확대/축소">
            <button type="button" className="spinbtn" onClick={handleZoomIn} title="확대" aria-label="확대">
              ▲
            </button>
            <div className="spinsep" aria-hidden="true" />
            <button type="button" className="spinbtn" onClick={handleZoomOut} title="축소" aria-label="축소">
              ▼
            </button>
          </div>
          <div className="btnbox" role="group" aria-label="맞춤">
            <button
              type="button"
              className={`segbtn`}
              onClick={handleFitWidth}
              title="너비 맞춤"
            >
              너비
            </button>
            <span className="segdiv" aria-hidden="true" />
            <button
              type="button"
              className={`segbtn`}
              onClick={handleFitHeight}
              title="높이 맞춤"
            >
              높이
            </button>
          </div>
        </div>
        <div className="group right">
          {fullscreen ? (
            <button
              className="btn"
              onClick={() => onFullscreenChange?.(false)}
              title="닫기(Q)"
            >
              닫기
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => onFullscreenChange?.(true)}
              title="전체화면"
            >
              전체화면
            </button>
          )}
          {reviewStatus === "pending" && (
            <button
              className="btn"
              onClick={onStartReview}
              title="검토 시작"
            >
              검토 시작
            </button>
          )}
          {reviewStatus === "in_progress" && (
            <button
              className="btn"
              onClick={onStopReview}
              title="검토 중지"
            >
              검토 중지
            </button>
          )}
          <button
            className="btn"
            onClick={handleSave}
            disabled={saving}
            title="서버에 저장"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* Tool settings popover (펜/형광펜 버튼을 한 번 더 누르면 열림) */}
      {openSettings && (
        <div
          ref={settingsPanelRef}
          className="pdf-viewer-tool-settings"
          style={{ left: settingsPos.left, top: settingsPos.top }}
          role="dialog"
          aria-label={openSettings === "ink" ? "펜 설정" : "형광펜 설정"}
        >
          {openSettings === "ink" ? (
            <>
              <div className="row">
                <div className="label">색</div>
                <div className="swatches">
                  {inkPalette.map((c, idx) => (
                    <button
                      key={`${c}-${idx}`}
                      type="button"
                      className={`swatch ${idx === inkPaletteIdx ? "active" : ""}`}
                      style={{ background: c }}
                      title={idx === inkPaletteIdx ? "선택됨 (한 번 더 클릭하면 색상 변경)" : "선택"}
                      onClick={() => {
                        if (idx !== inkPaletteIdx) {
                          setInkPaletteIdx(idx);
                          return;
                        }
                        inkColorPickerRef.current?.click();
                      }}
                    />
                  ))}
                </div>
                <input
                  ref={inkColorPickerRef}
                  type="color"
                  value={inkColor}
                  onChange={(e) => {
                    const next = e.target.value;
                    setInkPalette((prev) => prev.map((v, i) => (i === inkPaletteIdx ? next : v)));
                  }}
                  style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                  aria-hidden
                  tabIndex={-1}
                />
              </div>
              <div className="row">
                <div className="label">두께</div>
                <input
                  className="range"
                  type="range"
                  min={1}
                  max={24}
                  value={inkWidth}
                  onChange={(e) => setInkWidth(Math.max(1, Math.min(24, Number(e.target.value) || 2)))}
                />
                <input
                  className="num"
                  type="number"
                  min={1}
                  max={24}
                  value={inkWidth}
                  onChange={(e) => setInkWidth(Math.max(1, Math.min(24, Number(e.target.value) || 2)))}
                />
              </div>
            </>
          ) : (
            <>
              <div className="row">
                <div className="label">색</div>
                <div className="swatches">
                  {highlightPalette.map((c, idx) => (
                    <button
                      key={`${c}-${idx}`}
                      type="button"
                      className={`swatch ${idx === highlightPaletteIdx ? "active" : ""}`}
                      style={{ background: c }}
                      title={idx === highlightPaletteIdx ? "선택됨 (한 번 더 클릭하면 색상 변경)" : "선택"}
                      onClick={() => {
                        if (idx !== highlightPaletteIdx) {
                          setHighlightPaletteIdx(idx);
                          return;
                        }
                        highlightColorPickerRef.current?.click();
                      }}
                    />
                  ))}
                </div>
                <input
                  ref={highlightColorPickerRef}
                  type="color"
                  value={highlightColor}
                  onChange={(e) => {
                    const next = e.target.value;
                    setHighlightPalette((prev) => prev.map((v, i) => (i === highlightPaletteIdx ? next : v)));
                  }}
                  style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                  aria-hidden
                  tabIndex={-1}
                />
              </div>
              <div className="row">
                <div className="label">투명도</div>
                <input
                  className="range"
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={highlightOpacity}
                  onChange={(e) => setHighlightOpacity(Math.min(1, Math.max(0.05, Number(e.target.value) || 0.75)))}
                />
                <div className="pct">{Math.round(highlightOpacity * 100)}%</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* PDF 뷰어 영역 */}
      <div className="pdf-viewer-main">
        {/* x-scroll wrapper: toolbar should not move horizontally */}
        <div className="pdf-viewer-xscroll">
          {/* wrapper: relative로 설정하여 absolute container의 기준점이 됨 */}
          <div className="w-full relative" style={{ minHeight: "100%" }}>
            <div
              ref={containerRef}
              id="viewerContainer"
              className="pdf-viewer-container viewerContainer"
            >
              <div ref={viewerRef} id="viewer" className="pdf-viewer-viewer pdfViewer" style={{ background: "transparent" }} />
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-75 pointer-events-none z-10">
          <span className="text-gray-500">PDF 로딩 중...</span>
        </div>
      )}
    </div>
  );
}
