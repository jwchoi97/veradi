import type { PDFDocumentProxy } from "pdfjs-dist";
import { getAuthedUser } from "@/auth";
import { resolveApiUrl } from "@/data/files/api";

export async function saveAnnotatedPdf(params: {
  pdfDocument: PDFDocumentProxy;
  fileId: number;
  uploadUrl?: string; // optional override (absolute URL or backend-relative path)
}): Promise<{ object_key: string }> {
  const { pdfDocument, fileId, uploadUrl } = params;
  const resolvedUploadUrl = resolveApiUrl(uploadUrl || "/pdf/save");

  // 1) AnnotationStorage 포함하여 PDF 저장 (벡터 기반 PDF 수정본 생성)
  const annotationStorage = (pdfDocument as any).annotationStorage;
  const bytes: Uint8Array = await (pdfDocument as any).saveDocument(annotationStorage);

  // 2) 업로드용 Blob/FormData 생성
  // NOTE: pdf.js 타입이 Uint8Array<ArrayBufferLike>로 잡혀 SharedArrayBuffer가 섞일 수 있어,
  // TS만 통과시키기 위해 ArrayBuffer로 캐스팅해서 Blob으로 만듭니다.
  const ab = (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const blob = new Blob([ab], { type: "application/pdf" });
  const fd = new FormData();
  fd.append("file", blob, `annotated-${fileId}.pdf`);
  fd.append("file_id", String(fileId));

  // 3) 다운로드 없이 업로드
  const me = getAuthedUser();
  const headers: Record<string, string> = {};
  if (typeof me?.id === "number") headers["X-User-Id"] = String(me.id);

  const res = await fetch(resolvedUploadUrl, {
    method: "POST",
    body: fd,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to upload annotated PDF (${res.status})`);
  }

  return (await res.json()) as { object_key: string };
}

