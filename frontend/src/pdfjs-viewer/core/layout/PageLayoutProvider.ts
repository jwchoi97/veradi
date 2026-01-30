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
  const availableW = Math.max(1, container.clientWidth - padding * 2);

  let y = padding;
  for (let i = 0; i < pagesCount; i++) {
    const pageNum = i + 1;
    const pv = pdfViewer?.getPageView?.(i);
    const vp = pv?.viewport;
    if (!vp) continue;
    const width = Number(vp.width) || 1;
    const height = Number(vp.height) || 1;

    // pdf.js 기본 레이아웃은 가로 중앙 정렬(margin: auto)
    const centerOffset = Math.max(0, (availableW - width) / 2);
    const x = padding + centerOffset;

    pageMetrics.set(pageNum, { page: pageNum, x, y, width, height });
    y += height + gap;
  }

  return pageMetrics;
}

