import type { PageMetrics } from "../model/types";

export function computePageMetricsFromPdfLayout(params: {
  container: HTMLElement;
  pdfViewer: any;
  pdfDocument: any;
  padding: number;
  gap: number;
}): Map<number, PageMetrics> {
  const { container, pdfViewer, pdfDocument, padding, gap } = params;

  const pageMetrics: Map<number, PageMetrics> = new Map();
  const pagesCount = Number(pdfViewer?.pagesCount || pdfDocument?.numPages || 0);

  // 실제 DOM 위치 사용: 줌/스크롤 후에도 pdf.js 레이아웃과 정확히 일치
  const cr = container.getBoundingClientRect();
  const pageEls = Array.from(container.querySelectorAll(".page")) as HTMLElement[];
  if (pageEls.length >= pagesCount && cr.width > 0 && cr.height > 0) {
    for (let i = 0; i < pagesCount; i++) {
      const pageNum = i + 1;
      const pageEl = pageEls[i];
      if (!pageEl) continue;
      const pr = pageEl.getBoundingClientRect();
      const x = pr.left - cr.left;
      const y = pr.top - cr.top;
      const width = pr.width;
      const height = pr.height;
      if (Number.isFinite(x) && Number.isFinite(y) && width > 0 && height > 0) {
        pageMetrics.set(pageNum, { page: pageNum, x, y, width, height });
      }
    }
    if (pageMetrics.size > 0) return pageMetrics;
  }

  // 폴백: 수식 기반 (렌더 전)
  const availableW = Math.max(1, container.clientWidth - padding * 2);
  let y = padding;
  for (let i = 0; i < pagesCount; i++) {
    const pageNum = i + 1;
    const pv = pdfViewer?.getPageView?.(i);
    const vp = pv?.viewport;
    if (!vp) continue;
    const width = Number(vp.width) || 1;
    const height = Number(vp.height) || 1;
    const centerOffset = Math.max(0, (availableW - width) / 2);
    const x = padding + centerOffset;
    pageMetrics.set(pageNum, { page: pageNum, x, y, width, height });
    y += height + gap;
  }

  return pageMetrics;
}

