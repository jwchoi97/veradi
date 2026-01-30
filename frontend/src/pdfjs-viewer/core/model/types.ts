// Shared types for pdf.js + Konva viewer/annotations

export type AnnotationType = "ink" | "highlight" | "freetext" | "eraser" | "none";

export interface Annotation {
  id: string;
  type: "ink" | "highlight" | "freetext";
  page: number;
  data: any; // Konva shape 데이터 (v1/v2 혼재 가능)
  created_at: string;
}

export type PageMetrics = {
  page: number;
  x: number; // container scroll 좌표계
  y: number; // container scroll 좌표계
  width: number;
  height: number;
};

