import type { Annotation } from "../model/types";

export type AnnotationsByPage = Record<number, Annotation[]>;

export interface AnnotationStore {
  load(params: { fileId: string; userId: string }): Promise<AnnotationsByPage>;
  save(params: { fileId: string; userId: string; annotations: AnnotationsByPage }): Promise<void>;
}

