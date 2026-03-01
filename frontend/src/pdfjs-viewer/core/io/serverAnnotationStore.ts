import type { Annotation } from "../model/types";
import type { AnnotationStore, AnnotationsByPage } from "./AnnotationStore";
import { resolveApiUrl } from "@/data/files/api";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Minimal runtime validation + best-effort normalization.
function normalizeLoadedAnnotation(raw: any): Annotation | null {
  try {
    const id = typeof raw?.id === "string" ? raw.id : `${Date.now()}-${Math.random()}`;
    const page = Number(raw?.page || 1);
    if (!Number.isFinite(page) || page <= 0) return null;
    const created_at = typeof raw?.created_at === "string" ? raw.created_at : new Date().toISOString();
    const type = raw?.type;
    if (type !== "ink" && type !== "highlight" && type !== "freetext") return null;
    return { id, page, type, data: raw?.data ?? {}, created_at };
  } catch {
    return null;
  }
}

export class ServerAnnotationStore implements AnnotationStore {
  async load(params: { fileId: string; userId: string }): Promise<AnnotationsByPage> {
    const { fileId, userId } = params;
    try {
      const res = await fetch(resolveApiUrl(`/reviews/files/${fileId}/annotations`), {
        headers: { "X-User-Id": userId },
        credentials: "include",
      });
      if (!res.ok) return {};
      const data: unknown = await res.json();
      if (!isRecord(data)) return {};

      const anns = Array.isArray((data as any).annotations) ? (data as any).annotations : [];
      const byPage: Record<number, Annotation[]> = {};
      for (const ann of anns) {
        // Backend stores JSON in `text`.
        let payload: any = null;
        try {
          payload = ann?.text ? JSON.parse(ann.text) : null;
        } catch {
          payload = null;
        }
        const parsed = normalizeLoadedAnnotation({
          id: ann?.id,
          page: ann?.page,
          created_at: ann?.created_at,
          type: payload?.type,
          data: payload?.data ?? {},
        });
        if (!parsed) continue;
        if (!byPage[parsed.page]) byPage[parsed.page] = [];
        byPage[parsed.page].push(parsed);
      }
      return byPage;
    } catch {
      return {};
    }
  }

  async save(params: { fileId: string; userId: string; annotations: AnnotationsByPage }): Promise<void> {
    const { fileId, userId, annotations } = params;
    const annotationsList: any[] = [];
    Object.values(annotations).forEach((pageAnns) => {
      pageAnns.forEach((ann) => {
        const d = ann.data || {};
        annotationsList.push({
          id: ann.id,
          page: ann.page,
          // x,y are backend schema helper fields.
          x:
            d.x ||
            d.rect?.x ||
            d.rectNorm?.x ||
            (d.points?.[0] || (Array.isArray(d.pointsNorm) ? d.pointsNorm[0] : 0) || 0),
          y:
            d.y ||
            d.rect?.y ||
            d.rectNorm?.y ||
            (d.points?.[1] || (Array.isArray(d.pointsNorm) ? d.pointsNorm[1] : 0) || 0),
          text: JSON.stringify({ type: ann.type, data: ann.data }),
          created_at: ann.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      });
    });

    // Backend defaults to a minimal response for performance.
    const res = await fetch(resolveApiUrl(`/reviews/files/${fileId}/annotations?return_full=0`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userId,
      },
      credentials: "include",
      body: JSON.stringify({ annotations: annotationsList }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Save failed (${res.status})`);
    }
  }
}

