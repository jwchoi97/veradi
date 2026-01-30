// TODO: Extract KonvaAnnotationManager from `pdfjs-viewer/main.ts` into here.
//
// Note: This file is currently a placeholder. We keep minimal type definitions
// here so the frontend can compile even before the full extraction work lands.

export type AnnotationType = "ink" | "highlight" | "freetext" | "rect" | "unknown";

export type PageMetrics = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  scale?: number;
};

export type Annotation = {
  id: string;
  type: AnnotationType;
  page: number;
  // Normalized coordinates (0..1) for v2-style annotations
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  // Arbitrary payload per tool (ink points, text, etc.)
  data?: Record<string, unknown>;
  version?: 1 | 2;
};
