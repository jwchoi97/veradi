// @ts-nocheck
export type { Annotation, AnnotationType, PageMetrics } from "./core/model/types";
export { loadAnnotations, saveAnnotations } from "./api/annotations";
export { KonvaAnnotationManager } from "./core/engine/KonvaAnnotationManager";

// Legacy artifact (disabled; kept to preserve history).
class __PdfJsViewerMainTsArtifact {
  private scheduleContentDraw() {
    if (!this.contentLayer) return;
    if (this.contentDrawRaf !== null) return;
    this.contentDrawRaf = window.requestAnimationFrame(() => {
      this.contentDrawRaf = null;
      try { this.contentLayer?.batchDraw(); } catch (_e) { /* ignore */ }
    });
  }

  private scheduleUiDraw() {
    if (!this.uiLayer) return;
    if (this.uiDrawRaf !== null) return;
    this.uiDrawRaf = window.requestAnimationFrame(() => {
      this.uiDrawRaf = null;
      try { this.uiLayer?.batchDraw(); } catch (_e) { /* ignore */ }
    });
  }

  destroy() {
    try {
      this.clearSelection();
    } catch (_e) {
      /* ignore */
    }
    if (this.textEditingInput) {
      try { this.textEditingInput.remove(); } catch (_e) { /* ignore */ }
      this.textEditingInput = null;
    }
    // remove listeners/observers
    for (const fn of this.disposeFns.splice(0)) {
      try { fn(); } catch (_e) { /* ignore */ }
    }
    if (this.contentDrawRaf !== null) {
      try { window.cancelAnimationFrame(this.contentDrawRaf); } catch (_e) { /* ignore */ }
      this.contentDrawRaf = null;
    }
    if (this.uiDrawRaf !== null) {
      try { window.cancelAnimationFrame(this.uiDrawRaf); } catch (_e) { /* ignore */ }
      this.uiDrawRaf = null;
    }
    if (this.stage) {
      try { this.stage.destroy(); } catch (_e) { /* ignore */ }
      this.stage = null;
    }
    if (this.stageContainerEl) {
      try { this.stageContainerEl.remove(); } catch (_e) { /* ignore */ }
      this.stageContainerEl = null;
    }
  }

  updateStageSize() {
    if (!this.stage || !this.stageContainerEl) return;
    // ✅ IMPORTANT:
    // stageContainerEl is absolutely positioned and DOES affect scrollWidth/scrollHeight.
    // If we size the stage by container.scrollWidth, it can "self-inflate" and create
    // extra horizontal scroll range beyond the actual PDF pages.
    //
    // Prefer using pageMetrics (pdf.js viewport/layout) to size the overlay.
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
    } else {
      // fallback
      w = Math.max(1, this.container.scrollWidth);
      h = Math.max(1, this.container.scrollHeight);
    }
    this.stageContainerEl.style.width = `${w}px`;
    this.stageContainerEl.style.height = `${h}px`;
    this.stage.size({ width: w, height: h });
    this.stage.batchDraw();
  }

  private getOrCreatePageGroup(pageNum: number): Konva.Group {
    const existing = this.pageGroups.get(pageNum);
    if (existing) return existing;
    if (!this.contentLayer) throw new Error("Missing contentLayer");

    const g = new Konva.Group({ id: `page-${pageNum}` });
    // clip은 updatePageTransforms에서 page size를 알면 설정
    this.contentLayer.add(g);
    this.pageGroups.set(pageNum, g);
    return g;
  }

  private loadAnnotationToGroup(ann: Annotation, group: Konva.Group, pageNum: number) {
    const metrics = this.pageMetrics.get(pageNum);
    const pageW = metrics?.width || 1;
    const pageH = metrics?.height || 1;

    // v2: normalized 좌표 지원 (없으면 v1로 간주)
    const v = ann.data?.v;
    const data = ann.data || {};

    if (ann.type === "ink" && (data.points || (v === 2 && Array.isArray(data.pointsNorm)))) {
      const points: number[] = (() => {
        if (v === 2 && Array.isArray(data.pointsNorm)) {
          const out: number[] = [];
          for (let i = 0; i < data.pointsNorm.length; i += 2) {
            out.push((data.pointsNorm[i] || 0) * pageW, (data.pointsNorm[i + 1] || 0) * pageH);
          }
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
        hitStrokeWidth: Math.max(14, (data.width || 2) * 6),
        id: ann.id,
      });
      group.add(line);
    } else if (ann.type === "highlight" && v === 2 && data.kind === "stroke" && Array.isArray(data.pointsNorm)) {
      const points: number[] = (() => {
        const out: number[] = [];
        for (let i = 0; i < data.pointsNorm.length; i += 2) {
          out.push((data.pointsNorm[i] || 0) * pageW, (data.pointsNorm[i + 1] || 0) * pageH);
        }
        return out;
      })();
      const line = new Konva.Line({
        points,
        stroke: data.color || "rgba(255, 240, 102, 0.75)",
        strokeWidth: data.width || 12,
        lineCap: "round",
        lineJoin: "round",
        tension: 0.5,
        globalCompositeOperation: "multiply",
        perfectDrawEnabled: false,
        shadowForStrokeEnabled: false,
        hitStrokeWidth: Math.max(24, (data.width || 12) * 4),
        id: ann.id,
      });
      group.add(line);
    } else if (ann.type === "highlight" && data.rect) {
      const rectData = (() => {
        if (v === 2 && data.rectNorm) {
          return {
            x: (data.rectNorm.x || 0) * pageW,
            y: (data.rectNorm.y || 0) * pageH,
            width: (data.rectNorm.width || 0) * pageW,
            height: (data.rectNorm.height || 0) * pageH,
          };
        }
        return data.rect;
      })();
      const rect = new Konva.Rect({
        x: rectData.x,
        y: rectData.y,
        width: rectData.width,
        height: rectData.height,
        fill: data.color || "rgba(255, 240, 102, 0.45)",
        opacity: typeof data.opacity === "number" ? data.opacity : 1,
        globalCompositeOperation: "multiply",
        id: ann.id,
      });
      group.add(rect);
    } else if (ann.type === "freetext" && data.kind === "textbox") {
      const x = v === 2 && typeof data.xNorm === "number" ? data.xNorm * pageW : (data.x || 0);
      const y = v === 2 && typeof data.yNorm === "number" ? data.yNorm * pageH : (data.y || 0);
      const w = v === 2 && typeof data.widthNorm === "number" ? data.widthNorm * pageW : (data.width || 240);
      const h = v === 2 && typeof data.heightNorm === "number" ? data.heightNorm * pageH : (data.height || 90);
      const pad = typeof data.padding === "number" ? data.padding : 8;
      const fontSize = (() => {
        if (v === 2 && typeof data.fontSizeNorm === "number") return Math.max(10, data.fontSizeNorm * pageH);
        return data.fontSize || 16;
      })();

      const box = new Konva.Group({
        id: ann.id,
        x,
        y,
        draggable: true,
      });

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

      const text = new Konva.Text({
        name: "textbox-text",
        x: pad,
        y: pad,
        width: Math.max(1, w - pad * 2),
        height: Math.max(1, h - pad * 2),
        text: data.text || "",
        fontSize,
        fontFamily: data.fontFamily || "Arial",
        fill: data.color || "#111827",
        fontStyle: data.fontWeight === "bold" ? "bold" : "normal",
        wrap: "word",
        align: data.align || "left",
      });

      box.add(rect);
      box.add(text);
      group.add(box);
    } else if (ann.type === "freetext" && data.kind === "richtext" && Array.isArray(data.runs)) {
      const x = v === 2 && typeof data.xNorm === "number" ? data.xNorm * pageW : (data.x || 0);
      const y = v === 2 && typeof data.yNorm === "number" ? data.yNorm * pageH : (data.y || 0);
      const fontFamily = data.fontFamily || "Arial";
      const g = new Konva.Group({ id: ann.id, x, y, draggable: true });

      // simple multiline layout: explicit \n only (no auto-wrap)
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const measure = (text: string, font: string) => {
        if (!ctx) return text.length * 8;
        ctx.font = font;
        return ctx.measureText(text).width;
      };

      let cursorX = 0;
      let cursorY = 0;
      let lineH = 0;
      for (const rr of data.runs as any[]) {
        const t: string = String(rr?.text ?? "");
        if (!t) continue;
        const color = String(rr?.color || data.color || "#111827");
        const fontWeight = rr?.fontWeight === "bold" ? "bold" : "normal";
        const fontSizePx = (() => {
          if (typeof rr?.fontSizeNorm === "number") return Math.max(10, rr.fontSizeNorm * pageH);
          if (typeof rr?.fontSize === "number") return rr.fontSize;
          if (typeof data.fontSizeNorm === "number") return Math.max(10, data.fontSizeNorm * pageH);
          return 16;
        })();
        const chunks = t.split("\n");
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i] ?? "";
          if (chunk) {
            const node = new Konva.Text({
              x: cursorX,
              y: cursorY,
              text: chunk,
              fontFamily,
              fontSize: fontSizePx,
              fontStyle: fontWeight,
              fill: color,
              listening: false,
            });
            g.add(node);
            const font = `${fontWeight} ${fontSizePx}px ${fontFamily}`;
            cursorX += measure(chunk, font);
            lineH = Math.max(lineH, fontSizePx * 1.25);
          }
          if (i < chunks.length - 1) {
            cursorX = 0;
            cursorY += Math.max(14, lineH || fontSizePx * 1.25);
            lineH = 0;
          }
        }
      }
      group.add(g);
    } else if (ann.type === "freetext" && data.text) {
      const x = v === 2 && typeof data.xNorm === "number" ? data.xNorm * pageW : (data.x || 0);
      const y = v === 2 && typeof data.yNorm === "number" ? data.yNorm * pageH : (data.y || 0);
      const fontSize = (() => {
        if (v === 2 && typeof data.fontSizeNorm === "number") return Math.max(10, data.fontSizeNorm * pageH);
        return data.fontSize || 16;
      })();
      const text = new Konva.Text({
        x,
        y,
        text: data.text,
        fontSize,
        fontFamily: data.fontFamily || "Arial",
        fill: data.color || "#111827",
        fontStyle: data.fontWeight === "bold" ? "bold" : "normal",
        id: ann.id,
      });
      group.add(text);
    }
  }

  setMode(mode: AnnotationType) {
    const prevMode = this.currentMode;
    this.currentMode = mode;
    this.currentHighlightWidth = null;
    
    // 선택 모드에서만 selection/transformer 사용
    if (this.stageContainerEl) {
      // 선택 모드에서도 포인터 이벤트는 받아야 함
      this.stageContainerEl.style.cursor =
        mode === "none" ? "default" : mode === "eraser" ? "cell" : "crosshair";
      // ✅ 스크롤(터치/트랙패드) 허용: 선택 모드에서는 pan 허용, 드로잉/박스 생성은 none
      this.stageContainerEl.style.touchAction = mode === "none" ? "pan-x pan-y" : "none";
    }
    // Ensure hit testing works after drawing mode disabled it.
    try { this.contentLayer?.hitGraphEnabled(true); } catch (_e) { /* ignore */ }

    // Transformer 숨기기
    if (this.transformer && this.selectedNodes.length > 0) {
      this.transformer.detach();
      this.selectedNodes = [];
      const transformerLayer = this.transformer.getLayer();
      if (transformerLayer) transformerLayer.batchDraw();
    }

    // 텍스트 편집 입력 제거 (단, freetext로 들어갈 때는 편집 UI를 유지해야 함)
    if (this.textEditingInput && mode !== "freetext") {
      this.textEditingInput.remove();
      this.textEditingInput = null;
    }

    // 그리기 상태 초기화
    this.isDrawing = false;
    this.isErasing = false;
    this.isTextBoxCreating = false;
    this.textBoxStart = null;
    if (this.textBoxPreview) {
      this.textBoxPreview.destroy();
      this.textBoxPreview = null;
    }
    if (this.currentDrawing) {
      this.currentDrawing.destroy();
      this.currentDrawing = null;
    }
    if (this.marqueeRect) {
      this.marqueeRect.destroy();
      this.marqueeRect = null;
    }
    this.isMarquee = false;
    this.marqueeStart = null;
    this.lastErasedId = null;
    this.currentPoints = [];
  }

  setInkSettings(params: { color?: string; width?: number }) {
    if (typeof params.color === "string") this.inkSettings.color = params.color;
    if (typeof params.width === "number" && Number.isFinite(params.width)) this.inkSettings.width = Math.max(1, params.width);
  }

  setHighlightSettings(params: { color?: string; width?: number; opacity?: number }) {
    if (typeof params.width === "number" && Number.isFinite(params.width)) this.highlightSettings.width = Math.max(1, params.width);
    if (typeof params.opacity === "number" && Number.isFinite(params.opacity)) {
      this.highlightSettings.opacity = Math.min(1, Math.max(0.05, params.opacity));
    }
    if (typeof params.color === "string") {
      // color는 hex 또는 rgba 둘 다 허용 (렌더에서는 stroke+opacity 조합 사용)
      this.highlightSettings.color = params.color;
    }
  }

  getInkSettings() {
    return { ...this.inkSettings };
  }

  getHighlightSettings() {
    return { ...this.highlightSettings };
  }

  setTextSettings(params: { color?: string; fontSize?: number; fontFamily?: string; fontWeight?: "normal" | "bold" }) {
    if (typeof params.color === "string") this.textSettings.color = params.color;
    if (typeof params.fontFamily === "string" && params.fontFamily.trim()) this.textSettings.fontFamily = params.fontFamily;
    if (params.fontWeight === "normal" || params.fontWeight === "bold") this.textSettings.fontWeight = params.fontWeight;
    if (typeof params.fontSize === "number" && Number.isFinite(params.fontSize)) {
      this.textSettings.fontSize = Math.min(96, Math.max(10, params.fontSize));
    }
  }

  getTextSettings() {
    return { ...this.textSettings };
  }

  /**
   * ✅ JSON 기반 페이지 메트릭 계산 (DOM rect에 의존하지 않음)
   *
   * 전제:
   * - pdf.js의 page viewport(width/height)는 현재 스케일을 반영한 CSS px 값
   * - iframe CSS에서 viewerContainer padding과 page margin/gap을 고정해두어야 오차가 적음
   */
  updatePagesFromPdfLayout(opts?: { padding?: number; gap?: number }) {
    const padding = typeof opts?.padding === "number" ? opts!.padding : 16; // viewerContainer padding과 맞춰야 함
    const gap = typeof opts?.gap === "number" ? opts!.gap : 14; // 페이지 간격

    this.pageMetrics.clear();

    const pagesCount = Number(this.pdfViewer?.pagesCount || this.pdfDocument?.numPages || 0);
    const availableW = Math.max(1, this.container.clientWidth - padding * 2);

    let y = padding;
    for (let i = 0; i < pagesCount; i++) {
      const pageNum = i + 1;
      const pv = this.pdfViewer?.getPageView?.(i);
      const vp = pv?.viewport;
      if (!vp) continue;
      const width = Number(vp.width) || 1;
      const height = Number(vp.height) || 1;

      // pdf.js 기본 레이아웃은 가로 중앙 정렬(margin: auto) 이므로, container 폭 기반으로 x를 계산
      // ✅ floor 제거: 반복 줌/리사이즈에서 1px 드리프트(주석 흔들림)를 줄임
      const centerOffset = Math.max(0, (availableW - width) / 2);
      const x = padding + centerOffset;

      this.pageMetrics.set(pageNum, { page: pageNum, x, y, width, height });

      const g = this.getOrCreatePageGroup(pageNum);
      g.position({ x, y });
      g.clip({ x: 0, y: 0, width, height });

      y += height + gap;
    }

    this.updateStageSize();
    // 페이지 크기(줌) 변화 시, v2(normalized) 주석들은 새 크기에 맞춰 재계산
    this.rescaleAllPages();
    this.contentLayer?.batchDraw();
  }

  updatePages(pageElements: HTMLElement[]) {
    const containerRect = this.container.getBoundingClientRect();
    this.pageMetrics.clear();

    pageElements.forEach((pageEl, idx) => {
      const attr = pageEl.getAttribute("data-page-number") || pageEl.dataset?.pageNumber;
      const page = Number(attr || (idx + 1));
      const r = pageEl.getBoundingClientRect();
      const x = r.left - containerRect.left + this.container.scrollLeft;
      const y = r.top - containerRect.top + this.container.scrollTop;
      const width = r.width;
      const height = r.height;
      this.pageMetrics.set(page, { page, x, y, width, height });

      const g = this.getOrCreatePageGroup(page);
      g.position({ x, y });
      g.clip({ x: 0, y: 0, width, height });
    });

    this.updateStageSize();
    // 페이지 크기(줌) 변화 시, v2(normalized) 주석들은 새 크기에 맞춰 재계산
    this.rescaleAllPages();
    this.contentLayer?.batchDraw();
  }

  private rescaleAllPages() {
    for (const page of this.pageMetrics.keys()) {
      this.rescalePage(page);
    }
  }

  private rescalePage(page: number) {
    const m = this.pageMetrics.get(page);
    const g = this.pageGroups.get(page);
    if (!m || !g) return;
    const pageW = m.width || 1;
    const pageH = m.height || 1;

    const pageAnns = this.annotations[page] || [];
    pageAnns.forEach((ann) => {
      const node = g.findOne(`#${ann.id}`) as Konva.Node | null;
      if (!node) return;
      const data = ann.data || {};
      const v = data.v;

      if (ann.type === "ink" && v === 2 && Array.isArray(data.pointsNorm) && node instanceof Konva.Line) {
        const out: number[] = [];
        for (let i = 0; i < data.pointsNorm.length; i += 2) {
          out.push((data.pointsNorm[i] || 0) * pageW, (data.pointsNorm[i + 1] || 0) * pageH);
        }
        node.position({ x: 0, y: 0 });
        node.points(out);
        node.hitStrokeWidth(Math.max(14, (data.width || 2) * 6));
      }

      if (ann.type === "highlight" && v === 2 && data.kind === "stroke" && Array.isArray(data.pointsNorm) && node instanceof Konva.Line) {
        const out: number[] = [];
        for (let i = 0; i < data.pointsNorm.length; i += 2) {
          out.push((data.pointsNorm[i] || 0) * pageW, (data.pointsNorm[i + 1] || 0) * pageH);
        }
        node.position({ x: 0, y: 0 });
        node.points(out);
        node.strokeWidth(data.width || 12);
        node.hitStrokeWidth(Math.max(24, (data.width || 12) * 4));
        node.globalCompositeOperation("multiply");
      }

      if (ann.type === "highlight" && v === 2 && data.rectNorm && node instanceof Konva.Rect) {
        node.x((data.rectNorm.x || 0) * pageW);
        node.y((data.rectNorm.y || 0) * pageH);
        node.width((data.rectNorm.width || 0) * pageW);
        node.height((data.rectNorm.height || 0) * pageH);
        if (typeof data.opacity === "number") node.opacity(Math.min(1, Math.max(0.05, data.opacity)));
      }

      if (ann.type === "freetext" && v === 2 && node instanceof Konva.Text) {
        node.x((data.xNorm || 0) * pageW);
        node.y((data.yNorm || 0) * pageH);
        if (typeof data.fontSizeNorm === "number") node.fontSize(Math.max(10, data.fontSizeNorm * pageH));
      }

      if (ann.type === "freetext" && v === 2 && data.kind === "textbox" && node instanceof Konva.Group) {
        const x = (data.xNorm || 0) * pageW;
        const y = (data.yNorm || 0) * pageH;
        const w = Math.max(120, (data.widthNorm || 0.2) * pageW);
        const h = Math.max(60, (data.heightNorm || 0.1) * pageH);
        const pad = data.padding ?? 8;
        node.position({ x, y });
        const rect = node.findOne(".textbox-rect") as Konva.Rect | null;
        const text = node.findOne(".textbox-text") as Konva.Text | null;
        if (rect) {
          rect.width(w);
          rect.height(h);
        }
        if (text) {
          text.width(Math.max(1, w - pad * 2));
          text.height(Math.max(1, h - pad * 2));
          if (typeof data.fontSizeNorm === "number") text.fontSize(Math.max(10, data.fontSizeNorm * pageH));
        }
      }
    });
  }

  private updatePageTransforms() {
    // pageMetrics가 이미 있으면 group 위치를 보정(스크롤/리사이즈)
    if (this.pageMetrics.size === 0) return;
    for (const [page, metrics] of this.pageMetrics.entries()) {
      const g = this.pageGroups.get(page);
      if (!g) continue;
      // stage는 container scroll 좌표계이므로 group 위치는 유지. (updatePages에서 갱신)
      g.position({ x: metrics.x, y: metrics.y });
    }
  }

  private syncLayoutIfNeeded() {
    // scroll은 pageMetrics 자체를 바꾸지 않지만, resize/fullscreen은 "center x"가 바뀐다.
    const scale = Number(this.pdfViewer?.currentScale || 0) || 0;
    const key = `${this.container.clientWidth}x${this.container.clientHeight}|${scale}|${Number(this.pdfViewer?.pagesCount || 0)}`;
    if (this.lastLayoutKey === key) return;
    this.lastLayoutKey = key;
    // pageMetrics를 viewport 기반으로 재계산 (그 결과에 맞춰 모든 주석을 재스케일)
    this.updatePagesFromPdfLayout({ padding: 16, gap: 14 });
  }

  private bindStageEvents() {
    if (!this.stage) return;

    const stage = this.stage;

    const hitTestPage = (pos: { x: number; y: number }): number | null => {
      for (const [page, m] of this.pageMetrics.entries()) {
        if (pos.x >= m.x && pos.x <= m.x + m.width && pos.y >= m.y && pos.y <= m.y + m.height) {
          return page;
        }
      }
      return null;
    };

    const getPageLocal = (page: number, pos: { x: number; y: number }) => {
      const m = this.pageMetrics.get(page);
      if (!m) return null;
      return { x: pos.x - m.x, y: pos.y - m.y, w: m.width, h: m.height };
    };

    stage.on("dblclick dbltap", (evt: Konva.KonvaEventObject<MouseEvent>) => {
      // 선택 모드에서 더블클릭하면 텍스트 편집 진입
      if (this.currentMode !== "none") return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const raw = stage.getIntersection(pos);
      const node = raw ? (this.resolveAnnotationNode(raw) || raw) : null;
      if (!node) return;
      const page = this.getPageForNode(node);
      if (!page) return;
      const ann = (this.annotations[page] || []).find((a) => a.id === node.id());
      if (!ann || ann.type !== "freetext") return;

      evt.cancelBubble = true;
      try { (node as any).stopDrag?.(); } catch (_e) { /* ignore */ }
      if (this.requestModeChange) this.requestModeChange("freetext");
      else this.setMode("freetext");

      if (ann.data?.kind === "textbox") {
        this.openTextBoxEditorForId(page, node.id());
      } else {
        // plain text (and any future kinds like richtext)
        this.openPlainTextEditorForId(page, node.id());
      }
      evt.evt.preventDefault?.();
    });

    stage.on("pointerdown", (evt: Konva.KonvaEventObject<PointerEvent>) => {
      const pos = stage.getPointerPosition();
      if (!pos) return;

      // 선택 모드: 가장 위에 있는 노드 선택
      if (this.currentMode === "none") {
        const rawHit = stage.getIntersection(pos);
        const node = rawHit ? (this.resolveAnnotationNode(rawHit) || rawHit) : null;
        if (node) {
          // 단일 선택 (Shift 누르면 추가 선택)
          const shiftKey = !!evt.evt.shiftKey;
          this.setSelection(shiftKey ? [...this.selectedNodes, node] : [node]);
          // 잡고 드래그 이동
          if (node instanceof Konva.Line || node instanceof Konva.Rect || node instanceof Konva.Text || node instanceof Konva.Group) {
            node.draggable(true);
            // 텍스트는 더블클릭 편집 UX를 위해 pointerdown 즉시 startDrag는 하지 않음
            if (!(node instanceof Konva.Text)) {
              try { node.startDrag(); } catch (_e) { /* ignore */ }
            }
          }
        } else {
          // ✅ 터치(모바일/터치스크린)에서는 빈 공간 드래그를 스크롤로 쓰고 싶으므로 마키 선택을 시작하지 않음
          if ((evt.evt as any)?.pointerType === "touch") return;
          // 빈 공간 드래그 -> 마키 선택 시작
          if (!evt.evt.shiftKey) this.clearSelection();
          this.isMarquee = true;
          this.marqueeStart = { x: pos.x, y: pos.y };
          this.marqueeAdd = !!evt.evt.shiftKey;
          if (!this.marqueeRect) {
            this.marqueeRect = new Konva.Rect({
              x: pos.x,
              y: pos.y,
              width: 0,
              height: 0,
              stroke: "#6366f1",
              strokeWidth: 1,
              dash: [6, 4],
              fill: "rgba(99, 102, 241, 0.12)",
              listening: false,
            });
            this.uiLayer?.add(this.marqueeRect);
          }
          this.marqueeRect.position({ x: pos.x, y: pos.y });
          this.marqueeRect.size({ width: 0, height: 0 });
          this.scheduleUiDraw();
        }
        return;
      }

      // 지우개 모드
      if (this.currentMode === "eraser") {
        this.isErasing = true;
        this.eraseAt(pos);
        return;
      }

      const page = hitTestPage(pos);
      if (!page) return;
      this.activePage = page;
      const local = getPageLocal(page, pos);
      if (!local) return;

      const group = this.getOrCreatePageGroup(page);

      if (this.currentMode === "freetext") {
        // 편집 중이면, 캔버스에서 새 박스 생성/히트테스트를 하지 않음
        if (this.textEditingInput) return;

        // 텍스트 모드에서 기존 텍스트를 클릭하면 편집
        const rawHit = (() => {
          const t = evt.target as any;
          if (t && t !== stage && typeof t.getParent === "function") return t as Konva.Node;
          return stage.getIntersection(pos) as Konva.Node | null;
        })();
        const hit = rawHit ? (this.resolveAnnotationNode(rawHit) || rawHit) : null;
        if (hit) {
          const hitPage = this.getPageForNode(hit);
          if (hitPage) {
            const list = this.annotations[hitPage] || [];
            const ann = list.find((a) => a.id === hit.id());
            if (ann?.data?.kind === "textbox") {
              evt.cancelBubble = true;
              evt.evt.preventDefault?.();
              this.openTextBoxEditorForId(hitPage, hit.id());
              return;
            }
            if (hit instanceof Konva.Text) {
              evt.cancelBubble = true;
              evt.evt.preventDefault?.();
              this.openPlainTextEditorForId(hitPage, hit.id());
              return;
            }
          }
        }

        // ✅ 텍스트는 "박스"로 통일: 드래그로 크기 결정 후 textarea로 입력
        this.isTextBoxCreating = true;
        this.textBoxStart = { page, x: local.x, y: local.y };

        // preview rect (stage coords)
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
        this.scheduleUiDraw();
        return;
      }

      this.isDrawing = true;
      this.currentPoints = [local.x, local.y];

      if (this.currentMode === "ink") {
        const scale = Number(this.pdfViewer?.currentScale || 1) || 1;
        // Smoothing: keep strokes visually continuous even at low zoom.
        // At high zoom, reduce (but don't eliminate) smoothing to avoid "blobby" feel.
        const tension = scale >= 2 ? 0.18 : 0.55;
        this.currentDrawing = new Konva.Line({
          points: this.currentPoints,
          stroke: this.inkSettings.color,
          strokeWidth: this.inkSettings.width,
          lineCap: "round",
          lineJoin: "round",
          tension,
          perfectDrawEnabled: false,
          shadowForStrokeEnabled: false,
          hitStrokeWidth: Math.max(14, this.inkSettings.width * 6),
        });
        // Reduce work while actively drawing.
        try { this.currentDrawing.listening(false); } catch (_e) { /* ignore */ }
        try { this.contentLayer?.hitGraphEnabled(false); } catch (_e) { /* ignore */ }
        group.add(this.currentDrawing);
        this.scheduleContentDraw();
      } else if (this.currentMode === "highlight") {
        // 형광펜: 기본은 "직선(꺾임 없음)" + 일정 두께
        const opacity = this.highlightSettings.opacity;
        const color = this.highlightSettings.color;
        // 가능하면 pdf.js textLayer의 글자 라인 높이에 맞춰 strokeWidth를 자동 스냅
        const autoW = (() => {
          const ev = evt.evt as any;
          const cx = Number(ev?.clientX);
          const cy = Number(ev?.clientY);
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
          const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
          const span = el?.closest?.(".textLayer span") as HTMLElement | null;
          if (!span) return null;
          const r = span.getBoundingClientRect();
          const h = r.height;
          if (!Number.isFinite(h) || h <= 0) return null;
          return Math.min(60, Math.max(6, h * 0.9));
        })();
        const width = autoW ?? this.highlightSettings.width;
        this.currentHighlightWidth = width;
        // 직선은 points를 2개만 유지 (start/end)
        this.currentPoints = [local.x, local.y, local.x, local.y];
        this.currentDrawing = new Konva.Line({
          points: this.currentPoints,
          stroke: color,
          opacity,
          strokeWidth: width,
          lineCap: "butt",
          lineJoin: "miter",
          tension: 0,
          globalCompositeOperation: "multiply",
          perfectDrawEnabled: false,
          shadowForStrokeEnabled: false,
          hitStrokeWidth: Math.max(24, width * 4),
        });
        try { this.currentDrawing.listening(false); } catch (_e) { /* ignore */ }
        try { this.contentLayer?.hitGraphEnabled(false); } catch (_e) { /* ignore */ }
        group.add(this.currentDrawing);
        this.scheduleContentDraw();
      }
    });

    stage.on("pointermove", (evt: Konva.KonvaEventObject<PointerEvent>) => {
      const pos = stage.getPointerPosition();
      if (!pos) return;

      if (this.currentMode === "none" && this.isMarquee && this.marqueeStart && this.marqueeRect) {
        const x = Math.min(this.marqueeStart.x, pos.x);
        const y = Math.min(this.marqueeStart.y, pos.y);
        const w = Math.abs(pos.x - this.marqueeStart.x);
        const h = Math.abs(pos.y - this.marqueeStart.y);
        this.marqueeRect.position({ x, y });
        this.marqueeRect.size({ width: w, height: h });
        this.scheduleUiDraw();
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
        const localX = pos.x - m.x;
        const localY = pos.y - m.y;
        const x1 = this.textBoxStart.x;
        const y1 = this.textBoxStart.y;
        const x = Math.min(x1, localX);
        const y = Math.min(y1, localY);
        const w = Math.max(1, Math.abs(localX - x1));
        const h = Math.max(1, Math.abs(localY - y1));
        this.textBoxPreview.position({ x: m.x + x, y: m.y + y });
        this.textBoxPreview.size({ width: w, height: h });
        this.scheduleUiDraw();
        return;
      }

      if (!this.isDrawing) return;
      if (!this.activePage) return;
      const local = getPageLocal(this.activePage, pos);
      if (!local) return;

      // 형광펜은 "직선"만: start/end 2점만 업데이트
      if (this.currentMode === "highlight" && this.currentDrawing) {
        const pts = this.currentPoints;
        const sx = pts[0] ?? local.x;
        const sy = pts[1] ?? local.y;
        let x = local.x;
        let y = local.y;

        // ✅ Shift 누르면 수평/수직 스냅 (가로/세로 한쪽으로만)
        if (evt.evt?.shiftKey) {
          const dx = Math.abs(x - sx);
          const dy = Math.abs(y - sy);
          if (dx >= dy) y = sy;
          else x = sx;
        }
        if (!pts || pts.length < 4) {
          this.currentPoints = [sx, sy, x, y];
        } else {
          pts[2] = x;
          pts[3] = y;
        }
        this.currentDrawing.points(this.currentPoints);
        this.scheduleContentDraw();
        return;
      }

      // 간단 스무딩: 너무 촘촘한 포인트는 생략
      const pts = this.currentPoints;
      const lx = pts[pts.length - 2];
      const ly = pts[pts.length - 1];
      const dx = local.x - lx;
      const dy = local.y - ly;
      // When zoomed in, we need more points to avoid "blobby" / laggy strokes.
      const scale = Number(this.pdfViewer?.currentScale || 1) || 1;
      // Lower threshold at normal zoom to avoid "segmented" lines.
      const minDist = Math.max(0.18, 0.45 / scale);
      if ((dx * dx + dy * dy) < minDist * minDist) return;

      if (this.currentMode === "ink" && this.currentDrawing) {
        pts.push(local.x, local.y);
        this.currentDrawing.points(pts);
        this.scheduleContentDraw();
      } else if (this.currentMode === "highlight") {
        if (this.currentDrawing) {
          pts.push(local.x, local.y);
          this.currentDrawing.points(pts);
          this.scheduleContentDraw();
        }
      }
    });

    stage.on("pointerup pointercancel", (_evt: Konva.KonvaEventObject<PointerEvent>) => {
      const pos = stage.getPointerPosition();

      // 마키 선택 종료
      if (this.currentMode === "none" && this.isMarquee && this.marqueeRect) {
        this.isMarquee = false;
        const box = this.marqueeRect.getClientRect();
        this.marqueeRect.destroy();
        this.marqueeRect = null;
        this.scheduleUiDraw();

        const nodes = this.getSelectableNodes().filter((n) => {
          // ✅ 라인은 "바운딩 박스"가 아니라 실제 선이 박스에 닿을 때만 선택
          if (n instanceof Konva.Line) {
            return this.lineIntersectsRect(n, box);
          }
          // Rect/Text는 기존대로 영역 교차(실제 도형과 동일)
          const r = n.getClientRect({ skipTransform: false });
          return Konva.Util.haveIntersection(box, r);
        });
        this.setSelection(this.marqueeAdd ? [...this.selectedNodes, ...nodes] : nodes);
        this.marqueeAdd = false;
        return;
      }

      if (this.currentMode === "eraser") {
        this.isErasing = false;
        this.lastErasedId = null;
        return;
      }

      // 텍스트 박스 생성 종료
      if (this.currentMode === "freetext" && this.isTextBoxCreating && this.textBoxStart) {
        const page = this.textBoxStart.page;
        const m = this.pageMetrics.get(page);
        this.isTextBoxCreating = false;

        let x = this.textBoxStart.x;
        let y = this.textBoxStart.y;
        let w = 240;
        let h = 90;

        if (m && pos) {
          const localX = pos.x - m.x;
          const localY = pos.y - m.y;
          x = Math.min(this.textBoxStart.x, localX);
          y = Math.min(this.textBoxStart.y, localY);
          w = Math.max(120, Math.abs(localX - this.textBoxStart.x));
          h = Math.max(60, Math.abs(localY - this.textBoxStart.y));
        }

        if (this.textBoxPreview) {
          this.textBoxPreview.destroy();
          this.textBoxPreview = null;
          this.scheduleUiDraw();
        }
        this.textBoxStart = null;

        // textbox annotation 생성 + editor open
        const mm = this.pageMetrics.get(page);
        if (!mm) return;
        const pageW = mm.width || 1;
        const pageH = mm.height || 1;
        const id = this.newId("textbox");

        const data = {
          v: 2,
          kind: "textbox",
          xNorm: x / pageW,
          yNorm: y / pageH,
          widthNorm: Math.min(0.95, w / pageW),
          heightNorm: Math.min(0.95, h / pageH),
          padding: 8,
          text: "",
          fontFamily: "Arial",
          fontSizeNorm: 16 / pageH,
          color: "#111827",
          bgColor: "rgba(255,255,255,0)",
          borderColor: "rgba(17,24,39,0.35)",
          borderWidth: 1,
          align: "left",
        };

        const ann: Annotation = { id, type: "freetext", page, data, created_at: new Date().toISOString() };
        if (!this.annotations[page]) this.annotations[page] = [];
        this.annotations[page].push(ann);

        const g = this.getOrCreatePageGroup(page);
        this.loadAnnotationToGroup(ann, g, page);
        this.saveToUndo();
        this.scheduleContentDraw();

        // 바로 타이핑 가능하게 textarea 오픈
        this.openTextBoxEditorForId(page, id);
        return;
      }

      if (!this.isDrawing) return;
      this.isDrawing = false;
      if (!this.activePage) return;

      const page = this.activePage;
      const m = this.pageMetrics.get(page);
      const pageW = m?.width || 1;
      const pageH = m?.height || 1;

      if (this.currentMode === "ink" && this.currentDrawing) {
        const pts = this.currentPoints;
        const pointsNorm: number[] = [];
        for (let i = 0; i < pts.length; i += 2) {
          pointsNorm.push((pts[i] || 0) / pageW, (pts[i + 1] || 0) / pageH);
        }

        const id = `ink-${Date.now()}-${Math.random()}`;
        const ann: Annotation = {
          id,
          type: "ink",
          page,
          data: { v: 2, pointsNorm, color: this.inkSettings.color, width: this.inkSettings.width },
          created_at: new Date().toISOString(),
        };
        if (!this.annotations[page]) this.annotations[page] = [];
        this.annotations[page].push(ann);

        this.currentDrawing.id(id);
        try { this.currentDrawing.listening(true); } catch (_e) { /* ignore */ }
        this.currentDrawing = null;
        this.currentPoints = [];
        this.saveToUndo();
        try { this.contentLayer?.hitGraphEnabled(true); } catch (_e) { /* ignore */ }
        this.scheduleContentDraw();
      } else if (this.currentMode === "highlight" && this.currentDrawing) {
        const pts = this.currentPoints;
        const x1 = pts[0] || 0;
        const y1 = pts[1] || 0;
        const x2 = pts[2] ?? x1;
        const y2 = pts[3] ?? y1;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist2 = dx * dx + dy * dy;
        const width = this.currentHighlightWidth ?? this.highlightSettings.width;

        // ✅ 클릭만 한 경우(거의 이동 없음): 작은 직사각형 하이라이트 스탬프
        if (dist2 < 2.5 * 2.5) {
          const stampW = Math.max(24, width * 6);
          const stampH = Math.max(8, width);
          const rx = x1 - stampW / 2;
          const ry = y1 - stampH / 2;

          const id = `highlight-${Date.now()}-${Math.random()}`;
          const ann: Annotation = {
            id,
            type: "highlight",
            page,
            data: {
              v: 2,
              rectNorm: {
                x: rx / pageW,
                y: ry / pageH,
                width: stampW / pageW,
                height: stampH / pageH,
              },
              color: this.highlightSettings.color,
              opacity: this.highlightSettings.opacity,
            },
            created_at: new Date().toISOString(),
          };

          // 기존 선 제거 후 rect로 교체
          this.currentDrawing.destroy();
          this.currentDrawing = null;
          this.currentPoints = [];
          this.currentHighlightWidth = null;

          const g = this.getOrCreatePageGroup(page);
          const rect = new Konva.Rect({
            x: rx,
            y: ry,
            width: stampW,
            height: stampH,
            fill: this.highlightSettings.color,
            opacity: this.highlightSettings.opacity,
            globalCompositeOperation: "multiply",
            id,
          });
          g.add(rect);

          if (!this.annotations[page]) this.annotations[page] = [];
          this.annotations[page].push(ann);
          this.saveToUndo();
          try { this.contentLayer?.hitGraphEnabled(true); } catch (_e) { /* ignore */ }
          this.scheduleContentDraw();
        } else {
          // ✅ 드래그: 직선(highlight stroke) 저장
          const pointsNorm: number[] = [
            x1 / pageW, y1 / pageH,
            x2 / pageW, y2 / pageH,
          ];

          const id = `highlight-${Date.now()}-${Math.random()}`;
          const ann: Annotation = {
            id,
            type: "highlight",
            page,
            data: {
              v: 2,
              kind: "stroke",
              pointsNorm,
              color: this.highlightSettings.color,
              opacity: this.highlightSettings.opacity,
              width,
            },
            created_at: new Date().toISOString(),
          };

          this.currentDrawing.id(id);
          try { this.currentDrawing.listening(true); } catch (_e) { /* ignore */ }
          this.currentDrawing = null;
          this.currentPoints = [];
          this.currentHighlightWidth = null;
          if (!this.annotations[page]) this.annotations[page] = [];
          this.annotations[page].push(ann);
          this.saveToUndo();
          try { this.contentLayer?.hitGraphEnabled(true); } catch (_e) { /* ignore */ }
          this.scheduleContentDraw();
        }
      }

      this.activePage = null;
    });
  }

  private lineIntersectsRect(line: Konva.Line, box: { x: number; y: number; width: number; height: number }) {
    const pts = line.points();
    if (!pts || pts.length < 4) return false;

    // stroke 두께를 고려해서 박스를 약간 확장 (선이 "닿는" 감각을 더 정확히)
    const tol = Math.max(0, (line.strokeWidth() || 0) / 2);
    const rx = box.x - tol;
    const ry = box.y - tol;
    const rw = box.width + tol * 2;
    const rh = box.height + tol * 2;

    const inside = (x: number, y: number) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;

    // 라인 로컬 포인트를 stage 좌표로 변환
    const tr = line.getAbsoluteTransform();
    const toStage = (x: number, y: number) => tr.point({ x, y });

    const segIntersects = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      // 1) 끝점이 박스 내부면 교차
      if (inside(a.x, a.y) || inside(b.x, b.y)) return true;

      // 2) 선분 vs 박스 4변 교차
      const x1 = rx, y1 = ry, x2 = rx + rw, y2 = ry + rh;
      const edges = [
        [{ x: x1, y: y1 }, { x: x2, y: y1 }],
        [{ x: x2, y: y1 }, { x: x2, y: y2 }],
        [{ x: x2, y: y2 }, { x: x1, y: y2 }],
        [{ x: x1, y: y2 }, { x: x1, y: y1 }],
      ] as const;

      for (const [c, d] of edges) {
        if (this.segmentsIntersect(a, b, c, d)) return true;
      }
      return false;
    };

    for (let i = 0; i < pts.length - 2; i += 2) {
      const p1 = toStage(pts[i] || 0, pts[i + 1] || 0);
      const p2 = toStage(pts[i + 2] || 0, pts[i + 3] || 0);
      if (segIntersects(p1, p2)) return true;
    }
    return false;
  }

  private segmentsIntersect(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) {
    // orientation 기반 교차 테스트
    const orient = (p: any, q: any, r: any) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    const onSeg = (p: any, q: any, r: any) =>
      Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) &&
      Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);

    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);

    // 일반 케이스
    if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;

    // collinear 케이스
    const eps = 1e-9;
    if (Math.abs(o1) < eps && onSeg(a, c, b)) return true;
    if (Math.abs(o2) < eps && onSeg(a, d, b)) return true;
    if (Math.abs(o3) < eps && onSeg(c, a, d)) return true;
    if (Math.abs(o4) < eps && onSeg(c, b, d)) return true;

    return false;
  }

  private getSelectableNodes(): Konva.Node[] {
    const out: Konva.Node[] = [];
    for (const g of this.pageGroups.values()) {
      const nodes = g.getChildren((n) =>
        n instanceof Konva.Line || n instanceof Konva.Rect || n instanceof Konva.Text || n instanceof Konva.Group
      );
      out.push(...nodes);
    }
    return out;
  }

  private clearSelection() {
    clearSelectionImpl(this as any);
  }

  private resolveAnnotationNode(node: Konva.Node): Konva.Node | null {
    return resolveAnnotationNodeImpl(this as any, node);
  }

  private setSelection(nodes: Konva.Node[]) {
    setSelectionImpl(this as any, nodes);
  }

  private eraseAt(pos: { x: number; y: number }) {
    const raw = this.stage?.getIntersection(pos);
    const node = raw ? (this.resolveAnnotationNode(raw) || raw) : null;
    if (!node) return;
    const id = node.id();
    if (!id) return;
    if (this.lastErasedId === id) return;
    this.lastErasedId = id;

    // 페이지 찾기
    const page = this.getPageForNode(node);
    if (!page) return;
    const list = this.annotations[page] || [];
    const idx = list.findIndex((a) => a.id === id);
    if (idx >= 0) {
      list.splice(idx, 1);
      this.annotations[page] = list;
      node.destroy();
      this.saveToUndo();
      this.contentLayer?.batchDraw();
      this.uiLayer?.batchDraw();
    }
  }

  private showTextBoxEditor(params: {
    pageNum: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }) {
    const { pageNum, x, y, width, height } = params;
    if (!this.stage) return;

    // 기존 입력 제거
    if (this.textEditingInput) {
      this.textEditingInput.remove();
      this.textEditingInput = null;
    }

    const stageBox = this.stage.container().getBoundingClientRect();
    const screenX = stageBox.left + x;
    const screenY = stageBox.top + y;

    const ta = document.createElement("textarea");
    ta.style.position = "fixed";
    ta.style.left = `${screenX}px`;
    ta.style.top = `${screenY}px`;
    ta.style.width = `${Math.max(120, width)}px`;
    ta.style.height = `${Math.max(60, height)}px`;
    ta.style.fontSize = `${this.textSettings.fontSize}px`;
    ta.style.fontFamily = this.textSettings.fontFamily;
    ta.style.fontWeight = this.textSettings.fontWeight;
    ta.style.color = this.textSettings.color;
    ta.style.padding = "8px";
    ta.style.border = "2px solid #6366f1";
    ta.style.borderRadius = "6px";
    ta.style.outline = "none";
    ta.style.pointerEvents = "auto";
    ta.style.zIndex = "10000";
    ta.style.background = "white";
    ta.style.resize = "both";

    document.body.appendChild(ta);
    ta.focus();
    this.textEditingInput = ta;
    try { this.requestTextSettingsSync?.({ color: this.textSettings.color, fontSize: this.textSettings.fontSize, fontWeight: this.textSettings.fontWeight }); } catch (_e) { /* ignore */ }

    const save = () => {
      const text = ta.value;
      const m = this.pageMetrics.get(pageNum);
      if (!m) {
        ta.remove();
        return;
      }
      const pageW = m.width || 1;
      const pageH = m.height || 1;
      const id = this.newId("textbox");

      const data = {
        v: 2,
        kind: "textbox",
        xNorm: x / pageW,
        yNorm: y / pageH,
        widthNorm: Math.min(0.95, ta.getBoundingClientRect().width / pageW),
        heightNorm: Math.min(0.95, ta.getBoundingClientRect().height / pageH),
        padding: 8,
        text,
        fontFamily: this.textSettings.fontFamily,
        fontSizeNorm: this.textSettings.fontSize / pageH,
        color: this.textSettings.color,
        fontWeight: this.textSettings.fontWeight,
        bgColor: "rgba(255,255,255,0)",
        borderColor: "rgba(17,24,39,0.35)",
        borderWidth: 1,
        align: "left",
      };

      const ann: Annotation = {
        id,
        type: "freetext",
        page: pageNum,
        data,
        created_at: new Date().toISOString(),
      };
      if (!this.annotations[pageNum]) this.annotations[pageNum] = [];
      this.annotations[pageNum].push(ann);

      const g = this.getOrCreatePageGroup(pageNum);
      this.loadAnnotationToGroup(ann, g, pageNum);
      this.saveToUndo();
      this.contentLayer?.batchDraw();

      ta.remove();
      this.textEditingInput = null;
    };

    ta.addEventListener("blur", save);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        ta.remove();
      }
      // Enter는 줄바꿈이 필요하니 저장하지 않음(blur로 저장)
    });
  }

  private openTextBoxEditorForId(pageNum: number, id: string) {
    const list = this.annotations[pageNum] || [];
    const ann = list.find((a) => a.id === id);
    if (!ann) return;
    const data = ann.data || {};
    if (data.kind !== "textbox") return;
    const m = this.pageMetrics.get(pageNum);
    if (!m) return;
    const pageW = m.width || 1;
    const pageH = m.height || 1;

    const x = (data.xNorm || 0) * pageW;
    const y = (data.yNorm || 0) * pageH;
    const w = Math.max(120, (data.widthNorm || 0.2) * pageW);
    const h = Math.max(60, (data.heightNorm || 0.1) * pageH);

    // 기존 입력 제거
    if (this.textEditingInput) {
      this.textEditingInput.remove();
      this.textEditingInput = null;
    }
    if (!this.stage) return;
    const stageBox = this.stage.container().getBoundingClientRect();
    // page-local(x,y) -> stage coords는 (m.x + x, m.y + y)
    const screenX = stageBox.left + m.x + x;
    const screenY = stageBox.top + m.y + y;

    const ta = document.createElement("textarea");
    ta.value = data.text || "";
    ta.style.position = "fixed";
    ta.style.left = `${screenX}px`;
    ta.style.top = `${screenY}px`;
    ta.style.width = `${w}px`;
    ta.style.height = `${h}px`;
    const baseFontSize = 16;
    const baseColor = data.color || "#111827";
    const baseWeight: "normal" | "bold" = data.fontWeight === "bold" ? "bold" : "normal";
    ta.style.fontSize = `${baseFontSize}px`;
    ta.style.fontFamily = data.fontFamily || "Arial";
    ta.style.fontWeight = baseWeight;
    ta.style.color = baseColor;
    ta.style.padding = "8px";
    ta.style.border = "2px solid #6366f1";
    ta.style.borderRadius = "6px";
    ta.style.outline = "none";
    ta.style.pointerEvents = "auto";
    ta.style.zIndex = "10000";
    ta.style.background = "white";
    ta.style.resize = "both";
    document.body.appendChild(ta);
    ta.focus();
    this.textEditingInput = ta;
    try { this.requestTextSettingsSync?.({ color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight }); } catch (_e) { /* ignore */ }

    const commit = () => {
      const bb = ta.getBoundingClientRect();
      const raw = (ta.value || "").trim();
      const pad = data.padding ?? 8;
      const innerW = Math.max(40, Math.max(120, bb.width) - pad * 2);
      const fontSize = 16;
      const font = `${fontSize}px ${data.fontFamily || "Arial"}`;

      // ✅ 아무것도 안쓴 경우: 텍스트 상자(임시) 삭제
      if (!raw) {
        const idx = (this.annotations[pageNum] || []).findIndex((a) => a.id === id);
        if (idx >= 0) this.annotations[pageNum].splice(idx, 1);
        const g = this.getOrCreatePageGroup(pageNum);
        g.findOne(`#${id}`)?.destroy();
        this.clearSelection();
        this.saveToUndo();
        this.contentLayer?.batchDraw();
        ta.remove();
        this.textEditingInput = null;
        return;
      }

      // ✅ 드래그로 잡은 폭(innerW)에 맞게 줄바꿈을 실제로 삽입
      const wrapped = this.wrapTextToWidth({ text: raw, maxWidth: innerW, font });

      // ✅ 개념적으로 텍스트 상자는 제거하고 "텍스트만" 남김
      const textId = id; // id 유지 (선택/저장 호환)
      const xNorm = data.xNorm ?? 0;
      const yNorm = data.yNorm ?? 0;

      ann.type = "freetext";
      ann.data = {
        v: 2,
        // kind 제거 -> plain text
        xNorm,
        yNorm,
        fontFamily: data.fontFamily || "Arial",
        fontSizeNorm: fontSize / pageH,
        color: data.color || "#111827",
        text: wrapped,
      };

      const g = this.getOrCreatePageGroup(pageNum);
      // 기존 textbox 그룹 제거
      g.findOne(`#${id}`)?.destroy();

      // plain text 노드 생성 (wrap은 이미 줄바꿈으로 확정됐으니 width 지정 안함)
      const textNode = new Konva.Text({
        id: textId,
        x: xNorm * pageW,
        y: yNorm * pageH,
        text: wrapped,
        fontSize,
        fontFamily: data.fontFamily || "Arial",
        fill: data.color || "#111827",
      });
      g.add(textNode);

      this.saveToUndo();
      this.contentLayer?.batchDraw();

      ta.remove();
      this.textEditingInput = null;
    };

    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        ta.remove();
      }
    });
  }

  private openPlainTextEditorForId(pageNum: number, id: string) {
    const list = this.annotations[pageNum] || [];
    const ann = list.find((a) => a.id === id);
    if (!ann) return;
    const data = ann.data || {};
    if (data.kind === "textbox") return; // textbox는 commit 시 text로 바뀌어야 함
    if (!this.stage) return;

    const m = this.pageMetrics.get(pageNum);
    if (!m) return;
    const pageW = m.width || 1;
    const pageH = m.height || 1;

    const x = (data.xNorm || 0) * pageW;
    const y = (data.yNorm || 0) * pageH;

    // 기존 입력 제거
    if (this.textEditingInput) {
      this.textEditingInput.remove();
      this.textEditingInput = null;
    }

    const stageBox = this.stage.container().getBoundingClientRect();
    // page-local(x,y) -> stage coords는 (m.x + x, m.y + y)
    const screenX = stageBox.left + m.x + x;
    const screenY = stageBox.top + m.y + y;

    const ta = document.createElement("textarea");
    const initialText = (() => {
      if (data.kind === "richtext" && Array.isArray(data.runs)) {
        return (data.runs as any[]).map((r) => String(r?.text ?? "")).join("");
      }
      return data.text || "";
    })();
    ta.value = initialText;
    ta.style.position = "fixed";
    ta.style.left = `${screenX}px`;
    ta.style.top = `${screenY}px`;
    ta.style.width = `320px`;
    ta.style.height = `140px`;
    const baseFontSize = typeof data.fontSizeNorm === "number" ? Math.max(10, data.fontSizeNorm * pageH) : 16;
    const baseColor = data.color || "#111827";
    const baseWeight: "normal" | "bold" = data.fontWeight === "bold" ? "bold" : "normal";
    ta.style.fontSize = `${baseFontSize}px`;
    ta.style.fontFamily = data.fontFamily || "Arial";
    ta.style.fontWeight = baseWeight;
    ta.style.color = baseColor;
    ta.style.padding = "8px";
    ta.style.border = "2px solid #6366f1";
    ta.style.borderRadius = "6px";
    ta.style.outline = "none";
    ta.style.pointerEvents = "auto";
    ta.style.zIndex = "10000";
    ta.style.background = "white";
    ta.style.resize = "both";
    document.body.appendChild(ta);
    ta.focus();
    this.textEditingInput = ta;
    try { this.requestTextSettingsSync?.({ color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight }); } catch (_e) { /* ignore */ }

    // Initialize editing runs (single run if not rich).
    const initRuns =
      data.kind === "richtext" && Array.isArray(data.runs)
        ? (data.runs as any[]).map((r) => ({
            text: String(r?.text ?? ""),
            color: String(r?.color || baseColor),
            fontSize: typeof r?.fontSizeNorm === "number" ? Math.max(10, r.fontSizeNorm * pageH) : baseFontSize,
            fontWeight: r?.fontWeight === "bold" ? ("bold" as const) : ("normal" as const),
          }))
        : [{ text: initialText, color: baseColor, fontSize: baseFontSize, fontWeight: baseWeight }];

    this.activeTextEdit = {
      pageNum,
      id,
      pageH,
      runs: this.normalizeTextRuns(initRuns),
    };

    const commit = () => {
      const rawFull = ta.value || "";
      const rawTrim = rawFull.trim();
      if (!rawTrim) {
        // 빈 값이면 삭제
        const idx = list.findIndex((a) => a.id === id);
        if (idx >= 0) list.splice(idx, 1);
        this.annotations[pageNum] = list;
        const g = this.getOrCreatePageGroup(pageNum);
        g.findOne(`#${id}`)?.destroy();
        this.clearSelection();
        this.saveToUndo();
        this.contentLayer?.batchDraw();
        ta.remove();
        this.textEditingInput = null;
        this.activeTextEdit = null;
        return;
      }

      // If formatting was applied, save as richtext runs (no auto-wrap to preserve styled ranges).
      const hasRich = !!this.activeTextEdit && this.activeTextEdit.id === id;
      if (hasRich) {
        const runs = this.activeTextEdit!.runs;
        const runsText = runs.map((r) => r.text).join("");
        const canPreserveRuns = runsText === rawFull;
        if (!canPreserveRuns) {
          // Text changed after styling; fall back to plain text to avoid corrupt run mapping.
          data.text = rawTrim;
          data.fontSizeNorm = baseFontSize / pageH;
          data.color = baseColor;
          data.fontWeight = baseWeight;
          ann.data = data;
          const g = this.getOrCreatePageGroup(pageNum);
          const node = g.findOne(`#${id}`) as Konva.Text | null;
          if (node) node.text(rawTrim);
        } else {
        ann.data = {
          v: 2,
          kind: "richtext",
          xNorm: data.xNorm ?? (x / pageW),
          yNorm: data.yNorm ?? (y / pageH),
          fontFamily: data.fontFamily || "Arial",
          runs: runs.map((r) => ({
            text: r.text,
            color: r.color,
            fontWeight: r.fontWeight,
            fontSizeNorm: r.fontSize / pageH,
          })),
        };

        const g = this.getOrCreatePageGroup(pageNum);
        g.findOne(`#${id}`)?.destroy();
        this.loadAnnotationToGroup(ann, g, pageNum);
        }
      } else {
        // fallback plain text behavior
        data.text = rawTrim;
        data.fontSizeNorm = baseFontSize / pageH;
        data.color = baseColor;
        data.fontWeight = baseWeight;
        ann.data = data;
        const g = this.getOrCreatePageGroup(pageNum);
        const node = g.findOne(`#${id}`) as Konva.Text | null;
        if (node) node.text(rawTrim);
      }
      this.saveToUndo();
      this.contentLayer?.batchDraw();

      ta.remove();
      this.textEditingInput = null;
      this.activeTextEdit = null;
    };

    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        ta.remove();
      }
    });
  }

  private getPageForNode(node: Konva.Node): number | null {
    let cur: Konva.Node | null = node;
    while (cur) {
      if (cur instanceof Konva.Group) {
        const id = cur.id();
        if (id && id.startsWith("page-")) {
          const n = Number(id.slice("page-".length));
          return Number.isFinite(n) ? n : null;
        }
      }
      cur = cur.getParent();
    }
    return null;
  }

  private commitNodeDragToModel(node: Konva.Node) {
    const resolved = this.resolveAnnotationNode(node) || node;
    node = resolved;
    const page = this.getPageForNode(node);
    if (!page) return;
    const m = this.pageMetrics.get(page);
    if (!m) return;
    const pageW = m.width || 1;
    const pageH = m.height || 1;

    const ann = (this.annotations[page] || []).find(a => a.id === node.id());
    if (!ann) return;
    const data = ann.data || {};
    const v = data.v;

    if (node instanceof Konva.Line) {
      // line drag는 x/y 이동으로 표현되므로 points로 bake
      const dx = node.x();
      const dy = node.y();
      if (dx !== 0 || dy !== 0) {
        const pts = node.points();
        const baked: number[] = [];
        for (let i = 0; i < pts.length; i += 2) baked.push((pts[i] || 0) + dx, (pts[i + 1] || 0) + dy);
        node.position({ x: 0, y: 0 });
        node.points(baked);
        // v2 데이터면 normalized 업데이트
        if (v === 2) {
          const pointsNorm: number[] = [];
          for (let i = 0; i < baked.length; i += 2) pointsNorm.push((baked[i] || 0) / pageW, (baked[i + 1] || 0) / pageH);
          data.pointsNorm = pointsNorm;
          ann.data = data;
        }
      }
      return;
    }

    if (node instanceof Konva.Rect) {
      if (v === 2 && data.rectNorm) {
        data.rectNorm = {
          x: node.x() / pageW,
          y: node.y() / pageH,
          width: node.width() / pageW,
          height: node.height() / pageH,
        };
        ann.data = data;
      }
      return;
    }

    if (node instanceof Konva.Text) {
      if (v === 2) {
        data.xNorm = node.x() / pageW;
        data.yNorm = node.y() / pageH;
        if (typeof data.fontSizeNorm === "number") data.fontSizeNorm = node.fontSize() / pageH;
        ann.data = data;
      }
      return;
    }

    if (node instanceof Konva.Group) {
      // textbox 등의 그룹 위치/크기 커밋
      if (v === 2 && data.kind === "textbox") {
        data.xNorm = node.x() / pageW;
        data.yNorm = node.y() / pageH;

        const rect = node.findOne(".textbox-rect") as Konva.Rect | null;
        const text = node.findOne(".textbox-text") as Konva.Text | null;
        if (rect) {
          const w = rect.width() * (node.scaleX() || 1);
          const h = rect.height() * (node.scaleY() || 1);
          // scale을 실제 width/height로 bake
          rect.width(w);
          rect.height(h);
          node.scale({ x: 1, y: 1 });
          if (text) {
            const pad = data.padding ?? 8;
            text.width(Math.max(1, w - pad * 2));
            text.height(Math.max(1, h - pad * 2));
          }
          data.widthNorm = w / pageW;
          data.heightNorm = h / pageH;
        }
        ann.data = data;
      }
      return;
    }
  }

  deleteSelected() {
    deleteSelectedImpl(this as any);
  }

  copySelectedToClipboard() {
    copySelectedToClipboardImpl(this as any);
  }

  cutSelectedToClipboard() {
    cutSelectedToClipboardImpl(this as any);
  }

  async pasteFromClipboard(targetPage: number) {
    await pasteFromClipboardImpl(this as any, targetPage);
  }

  undo() {
    if (this.undoStack.length <= 1) return;
    this.redoStack.push(JSON.parse(JSON.stringify(this.annotations)));
    this.undoStack.pop();
    if (this.undoStack.length > 0) {
      this.annotations = JSON.parse(JSON.stringify(this.undoStack[this.undoStack.length - 1]));
      this.reloadAllAnnotations();
    }
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.saveToUndo();
    this.annotations = JSON.parse(JSON.stringify(this.redoStack.pop()));
    this.reloadAllAnnotations();
  }

  private saveToUndo() {
    this.undoStack.push(JSON.parse(JSON.stringify(this.annotations)));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  private reloadAllAnnotations() {
    // ✅ Undo/Redo 등에서 page group을 통째로 destroy하면 (0,0)에 잠깐 그려졌다가
    // 다음 레이아웃 tick에서 이동하면서 "움찔"거림이 발생한다.
    // 그래서 group 자체는 유지하고 children만 교체한다.
    this.clearSelection();

    const desiredPages = new Set<number>();
    for (const k of Object.keys(this.annotations)) {
      const p = Number(k);
      if (Number.isFinite(p)) desiredPages.add(p);
    }

    // 제거된 페이지 그룹 정리 + 기존 그룹 children 제거
    for (const [page, g] of this.pageGroups.entries()) {
      if (!desiredPages.has(page)) {
        g.destroy();
        this.pageGroups.delete(page);
        continue;
      }
      g.destroyChildren();
    }

    // 필요한 페이지 그룹 생성 + 주석 재로딩 (현재 pageMetrics가 있으면 즉시 position/clip 적용)
    for (const page of Array.from(desiredPages).sort((a, b) => a - b)) {
      const g = this.getOrCreatePageGroup(page);
      const m = this.pageMetrics.get(page);
      if (m) {
        g.position({ x: m.x, y: m.y });
        g.clip({ x: 0, y: 0, width: m.width, height: m.height });
      }
      const anns = this.annotations[page] || [];
      anns.forEach((ann) => this.loadAnnotationToGroup(ann, g, page));
    }

    this.contentLayer?.batchDraw();
    this.uiLayer?.batchDraw();
  }

  async save(): Promise<void> {
    await saveAnnotations(this.fileId, this.userId, this.annotations);
  }

  getAnnotations(): Record<number, Annotation[]> {
    return this.annotations;
  }
}
