import type { Annotation } from "../core/model/types";
import { ServerAnnotationStore } from "../core/io/serverAnnotationStore";

const store = new ServerAnnotationStore();

// 주석 데이터 저장/로드 (백엔드 스키마 호환)
export async function loadAnnotations(fileId: string, userId: string): Promise<Record<number, Annotation[]>> {
  return await store.load({ fileId, userId });
}

export async function saveAnnotations(fileId: string, userId: string, annotations: Record<number, Annotation[]>): Promise<void> {
  await store.save({ fileId, userId, annotations });
}

