import React, { useMemo, useState, useEffect, useRef } from "react";
import { Upload, Trash2, Loader2, Download } from "lucide-react";
import {
  fetchProjects,
  getProjectFiles,
  uploadProjectFile,
  Project,
  FileAsset,
  deleteProjectFile,
  getProjectIndividualItemsCount,
  getFileDownloadUrl,
  getFileReviewSummariesBulk,
  getFileInlineUrl,
  type FileReviewSessionsOut,
} from "../data/files/api";
import { getAuthedUser } from "@/auth";
import ProjectListTable from "@/components/projects/ProjectListTable";
import UploadDropzone from "@/components/files/UploadDropzone";
import { DEPARTMENTS, DEPARTMENT_LABEL, prettyDepartment } from "@/data/departments";

/* ---------- helpers ---------- */
function getFileExt(filename?: string | null) {
  if (!filename) return "";
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return "";
  return filename.slice(idx + 1).toUpperCase();
}

function extLowerFromName(name: string) {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i + 1).toLowerCase();
}

type SlotState = {
  existing: FileAsset | null;
  queued: File | null;
};

type SlotPairState = { pdf: SlotState; hwp: SlotState };

function pickBySetAndExt(files: FileAsset[], setIndex: number, ext: "pdf" | "hwp"): FileAsset | null {
  const filtered = files.filter(
    (f) => (f.set_index ?? 0) === setIndex && extLowerFromName(f.original_name ?? "") === ext
  );
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => {
    const at = a.created_at ?? "";
    const bt = b.created_at ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
  return filtered[filtered.length - 1];
}

function ReviewStatusCell({
  fileId,
  summary,
  onOpenPdf,
}: {
  fileId: number;
  summary: FileReviewSessionsOut | undefined;
  onOpenPdf: (opts?: { reviewerUserId?: number; variant?: "baked" | "original" }) => void;
}) {
  const [openMenu, setOpenMenu] = useState<"revision" | "approved" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const revSessions = summary?.sessions.filter((s) => s.status === "request_revision") ?? [];
  const appSessions = summary?.sessions.filter((s) => s.status === "approved") ?? [];
  const revCount = summary?.request_revision_count ?? 0;
  const appCount = summary?.approved_count ?? 0;

  const renderBadge = (
    label: string,
    count: number,
    menuType: "revision" | "approved",
    sessions: typeof revSessions,
    badgeClass: string
  ) => {
    if (count === 0) {
      return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}>
          {label} 0
        </span>
      );
    }
    const isOpen = openMenu === menuType;
    return (
      <div ref={menuRef} className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpenMenu(isOpen ? null : menuType)}
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold hover:underline cursor-pointer ${badgeClass}`}
          title={`${label} ${count}건 - 클릭하여 각 항목 보기`}
        >
          {label} {count}
        </button>
        {isOpen && sessions.length > 0 && (
          <div className="absolute left-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border bg-white shadow-lg py-1">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100"
                onClick={() => {
                  onOpenPdf({ reviewerUserId: s.reviewer_id ?? undefined, variant: "baked" });
                  setOpenMenu(null);
                }}
              >
                {s.reviewer_name ?? `유저 #${s.reviewer_id}`}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {renderBadge("수정요청", revCount, "revision", revSessions, "bg-red-100 text-red-800")}
      {renderBadge("검토완료", appCount, "approved", appSessions, "bg-green-100 text-green-800")}
    </div>
  );
}

function getBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!baseUrl) throw new Error("VITE_API_BASE_URL is not set");
  return baseUrl.replace(/\/+$/, "");
}

function formatZipNameByDate(): string {
  const yyyyMmDd = new Date().toISOString().slice(0, 10);
  return `files_${yyyyMmDd}.zip`;
}

async function downloadBlobAsFile(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.URL.revokeObjectURL(url);
  }
}

/* ---------- main page ---------- */
export default function IndividualItemUploadPage() {
  const years = useMemo(() => ["전체", "2025", "2026", "2027"], []);
  const subjects = useMemo(() => ["전체", ...DEPARTMENTS.map((d) => DEPARTMENT_LABEL[d])], []);
  const viewOptions = useMemo(() => ["진행중인 프로젝트만", "모두 보기"], []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());

  const [projectFilesMap, setProjectFilesMap] = useState<Record<number, FileAsset[]>>({});
  const [filesLoadingMap, setFilesLoadingMap] = useState<Record<number, boolean>>({});
  const [individualItemsCountMap, setIndividualItemsCountMap] = useState<Record<number, number>>({});

  const [fileReviewSessionsByFileId, setFileReviewSessionsByFileId] = useState<Record<number, FileReviewSessionsOut>>({});

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [modalProject, setModalProject] = useState<Project | null>(null);

  /** set_index(1..N) -> PDF/HWP slot state */
  const [queuedSlotsBySetIndex, setQueuedSlotsBySetIndex] = useState<Record<number, SlotPairState>>({});
  const [batchUploading, setBatchUploading] = useState(false);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const [selectedFileIdsByProject, setSelectedFileIdsByProject] = useState<Record<number, Set<number>>>({});
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const getSelectedSet = (projectId: number) => selectedFileIdsByProject[projectId] ?? new Set<number>();
  const setSelectedSet = (projectId: number, next: Set<number>) => {
    setSelectedFileIdsByProject((prev) => ({ ...prev, [projectId]: next }));
  };

  const toggleSelected = (projectId: number, fileId: number) => {
    const next = new Set(getSelectedSet(projectId));
    if (next.has(fileId)) next.delete(fileId);
    else next.add(fileId);
    setSelectedSet(projectId, next);
  };

  const pruneSelection = (projectId: number, files: FileAsset[]) => {
    setSelectedFileIdsByProject((prev) => {
      const cur = prev[projectId];
      if (!cur || cur.size === 0) return prev;
      const alive = new Set(files.map((f) => f.id));
      const next = new Set<number>();
      cur.forEach((id) => {
        if (alive.has(id)) next.add(id);
      });
      return { ...prev, [projectId]: next };
    });
  };

  const clearAllSelection = () => setSelectedFileIdsByProject({});

  const getAllSelectedPairs = useMemo(() => {
    const pairs: Array<{ projectId: number; file: FileAsset }> = [];
    for (const [pidStr, sel] of Object.entries(selectedFileIdsByProject)) {
      const projectId = Number(pidStr);
      if (!sel || sel.size === 0) continue;
      const files = projectFilesMap[projectId] ?? [];
      const individualItems = files.filter((f) => (f.file_type ?? "").trim() === "개별문항");
      for (const f of individualItems) {
        if (sel.has(f.id)) pairs.push({ projectId, file: f });
      }
    }
    return pairs;
  }, [projectFilesMap, selectedFileIdsByProject]);

  const globalSelectedCount = getAllSelectedPairs.length;
  const bulkBusy = isBulkDownloading || isBulkDeleting;

  const openReadonlyPdfInNewTab = async (
    fileAssetId: number,
    options?: { reviewerUserId?: number; variant?: "baked" | "original" }
  ) => {
    const w = window.open("about:blank", "_blank");
    if (!w) {
      alert("팝업이 차단되어 새 탭을 열 수 없습니다. 브라우저에서 팝업 차단을 해제해 주세요.");
      return;
    }
    try {
      w.document.title = "PDF 로딩 중...";
      w.document.body.innerHTML =
        "<div style='font-family:system-ui; padding:24px; color:#111827;'>PDF 로딩 중...</div>";
    } catch {
      /* ignore */
    }
    try {
      const { url } = await getFileInlineUrl(fileAssetId, {
        variant: options?.variant ?? "baked",
        reviewerUserId: options?.reviewerUserId,
      });
      w.location.href = url;
    } catch (e) {
      console.error(e);
      try {
        w.close();
      } catch {
        /* ignore */
      }
      alert("PDF를 여는 데 실패했습니다.");
    }
  };

  const refreshReviewStatuses = async () => {
    try {
      const allFileIds: number[] = [];
      for (const files of Object.values(projectFilesMap)) {
        for (const f of files) {
          if ((f.file_type ?? "").trim() !== "개별문항") continue;
          if (extLowerFromName(f.original_name ?? "") !== "pdf") continue;
          allFileIds.push(f.id);
        }
      }
      if (allFileIds.length === 0) {
        setFileReviewSessionsByFileId({});
        return;
      }
      const { summaries } = await getFileReviewSummariesBulk(allFileIds);
      const next: Record<number, FileReviewSessionsOut> = {};
      for (const s of summaries) {
        next[s.file_asset_id] = s;
      }
      setFileReviewSessionsByFileId(next);
    } catch (e) {
      console.warn("Failed to load review sessions", e);
    }
  };

  const loadProjects = async () => {
    try {
      setListLoading(true);
      setError(null);
      const data = await fetchProjects();
      const normalized = data.map((p) => ({
        ...p,
        subject: prettyDepartment((p as any).subject),
      })) as Project[];

      setProjects(normalized);

      const countPromises = normalized.map(async (p) => {
        try {
          const countData = await getProjectIndividualItemsCount(p.id);
          return { projectId: p.id, count: countData.individual_items_count };
        } catch {
          return { projectId: p.id, count: 0 };
        }
      });

      const counts = await Promise.all(countPromises);
      const countMap: Record<number, number> = {};
      counts.forEach(({ projectId, count }) => {
        countMap[projectId] = count;
      });
      setIndividualItemsCountMap(countMap);
    } catch {
      setError("프로젝트 목록을 불러오는 데 실패했습니다.");
    } finally {
      setListLoading(false);
    }
  };

  const loadProjectFiles = async (projectId: number) => {
    try {
      setFilesLoadingMap((prev) => ({ ...prev, [projectId]: true }));
      const files = await getProjectFiles(projectId);
      setProjectFilesMap((prev) => ({ ...prev, [projectId]: files }));
      pruneSelection(projectId, files);

      try {
        const countData = await getProjectIndividualItemsCount(projectId);
        setIndividualItemsCountMap((prev) => ({
          ...prev,
          [projectId]: countData.individual_items_count,
        }));
      } catch {
        /* ignore */
      }
      return files;
    } catch {
      setProjectFilesMap((prev) => ({ ...prev, [projectId]: [] }));
      return [] as FileAsset[];
    } finally {
      setFilesLoadingMap((prev) => ({ ...prev, [projectId]: false }));
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    void refreshReviewStatuses();
  }, [projectFilesMap]);

  const handleToggleExpand = (p: Project) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) {
        next.delete(p.id);
        return next;
      }
      next.add(p.id);
      const alreadyLoaded = Object.prototype.hasOwnProperty.call(projectFilesMap, p.id);
      if (!alreadyLoaded) void loadProjectFiles(p.id);
      return next;
    });
  };

  const reject = (msg: string) => {
    setUploadSuccess(null);
    setUploadError(msg);
  };

  const clearMsg = () => {
    setUploadError(null);
    setUploadSuccess(null);
  };

  const openUploadModal = async (p: Project) => {
    setModalProject(p);
    clearMsg();

    const files = await loadProjectFiles(p.id);
    const individualFiles = files.filter((f) => (f.file_type ?? "").trim() === "개별문항");
    const target = (p as any).target_individual_items_count ?? 20;

    const initSlots: Record<number, SlotPairState> = {};
    for (let setIndex = 1; setIndex <= target; setIndex++) {
      initSlots[setIndex] = {
        pdf: { existing: pickBySetAndExt(individualFiles, setIndex, "pdf"), queued: null },
        hwp: { existing: pickBySetAndExt(individualFiles, setIndex, "hwp"), queued: null },
      };
    }
    setQueuedSlotsBySetIndex(initSlots);
    setIsUploadModalOpen(true);
  };

  const closeUploadModal = () => {
    if (batchUploading) return;
    setIsUploadModalOpen(false);
    setModalProject(null);
    setQueuedSlotsBySetIndex({});
    clearMsg();
  };

  const setQueuedSlotFile = (setIndex: number, kind: "pdf" | "hwp", file: File) => {
    clearMsg();
    setQueuedSlotsBySetIndex((prev) => {
      const cur = prev[setIndex];
      if (!cur) return prev;
      if (cur[kind].existing) {
        reject(`이미 업로드된 세트 ${setIndex} ${kind.toUpperCase()} 파일이 있습니다. 삭제 후 업로드하세요.`);
        return prev;
      }
      if (cur[kind].queued) {
        reject(`세트 ${setIndex} ${kind.toUpperCase()} 슬롯은 이미 선택되어 있습니다.`);
        return prev;
      }
      return {
        ...prev,
        [setIndex]: { ...cur, [kind]: { ...cur[kind], queued: file } },
      };
    });
  };

  const removeQueuedSlotFile = (setIndex: number, kind: "pdf" | "hwp") => {
    setQueuedSlotsBySetIndex((prev) => {
      const cur = prev[setIndex];
      if (!cur) return prev;
      return { ...prev, [setIndex]: { ...cur, [kind]: { ...cur[kind], queued: null } } };
    });
  };

  const deleteExistingSlotFile = async (setIndex: number, kind: "pdf" | "hwp") => {
    if (!modalProject) return;
    const cur = queuedSlotsBySetIndex[setIndex];
    const existing = cur?.[kind].existing;
    if (!existing) return;

    if (!window.confirm("정말로 이 파일을 삭제하시겠습니까?")) return;

    clearMsg();
    try {
      await deleteProjectFile(modalProject.id, existing.id);

      const files = await loadProjectFiles(modalProject.id);
      const individualFiles = files.filter((f) => (f.file_type ?? "").trim() === "개별문항");

      setQueuedSlotsBySetIndex((prev) => {
        const c = prev[setIndex];
        if (!c) return prev;
        return {
          ...prev,
          [setIndex]: {
            pdf: { existing: pickBySetAndExt(individualFiles, setIndex, "pdf"), queued: c.pdf.queued },
            hwp: { existing: pickBySetAndExt(individualFiles, setIndex, "hwp"), queued: c.hwp.queued },
          },
        };
      });
      setUploadSuccess("삭제 완료");
      await refreshReviewStatuses();
    } catch {
      reject("파일 삭제에 실패했습니다.");
    }
  };

  const totalQueuedCount = useMemo(() => {
    let n = 0;
    for (const s of Object.values(queuedSlotsBySetIndex)) {
      if (s?.pdf.queued) n += 1;
      if (s?.hwp.queued) n += 1;
    }
    return n;
  }, [queuedSlotsBySetIndex]);

  const handleBatchUpload = async () => {
    if (!modalProject) return;
    if (totalQueuedCount === 0) {
      reject("업로드할 파일을 추가하세요.");
      return;
    }

    clearMsg();
    setBatchUploading(true);

    try {
      for (const [setIndexStr, s] of Object.entries(queuedSlotsBySetIndex)) {
        const setIndex = Number(setIndexStr);
        if (!s || !Number.isInteger(setIndex) || setIndex < 1) continue;
        if (s.pdf.queued) await uploadProjectFile(modalProject.id, s.pdf.queued, "개별문항", { setIndex });
        if (s.hwp.queued) await uploadProjectFile(modalProject.id, s.hwp.queued, "개별문항", { setIndex });
      }

      setUploadSuccess("업로드 성공!");

      const files = await loadProjectFiles(modalProject.id);
      await refreshReviewStatuses();

      const target = (modalProject as any).target_individual_items_count ?? 20;
      const individualFiles = files.filter((f) => (f.file_type ?? "").trim() === "개별문항");
      const nextSlots: Record<number, SlotPairState> = {};
      for (let idx = 1; idx <= target; idx++) {
        nextSlots[idx] = {
          pdf: { existing: pickBySetAndExt(individualFiles, idx, "pdf"), queued: null },
          hwp: { existing: pickBySetAndExt(individualFiles, idx, "hwp"), queued: null },
        };
      }
      setQueuedSlotsBySetIndex(nextSlots);

      if (expandedProjectIds.has(modalProject.id)) {
        await loadProjectFiles(modalProject.id);
      }
    } catch {
      reject("업로드 실패");
    } finally {
      setBatchUploading(false);
    }
  };

  const bulkDownloadZipGlobal = async () => {
    if (globalSelectedCount === 0 || bulkBusy) return;
    const fileIds = getAllSelectedPairs.map((x) => x.file.id);
    const me = getAuthedUser();
    const uid = me?.id;

    setIsBulkDownloading(true);
    try {
      const res = await fetch(`${getBaseUrl()}/projects/files/bulk-download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(typeof uid === "number" && Number.isFinite(uid) ? { "X-User-Id": String(uid) } : {}),
        },
        body: JSON.stringify({ file_ids: fileIds }),
        credentials: "include",
      });
      if (!res.ok) throw new Error(`bulk-download failed: ${res.status}`);
      const blob = await res.blob();
      await downloadBlobAsFile(blob, formatZipNameByDate());
    } catch (e) {
      console.error(e);
      try {
        for (const x of getAllSelectedPairs) {
          const { url } = await getFileDownloadUrl(x.projectId, x.file.id);
          window.open(url, "_blank");
        }
      } catch (e2) {
        console.error(e2);
        alert("다운로드에 실패했습니다.");
      }
    } finally {
      setIsBulkDownloading(false);
    }
  };

  const bulkDeleteGlobal = async () => {
    if (globalSelectedCount === 0 || bulkBusy) return;
    if (!window.confirm(`선택한 파일 ${globalSelectedCount}개를 삭제하시겠습니까?`)) return;

    setIsBulkDeleting(true);
    try {
      await Promise.all(getAllSelectedPairs.map((x) => deleteProjectFile(x.projectId, x.file.id)));
      const expanded = Array.from(expandedProjectIds);
      await Promise.all(expanded.map((pid) => loadProjectFiles(pid)));
      await refreshReviewStatuses();
      clearAllSelection();
    } catch (e) {
      console.error(e);
      alert("파일 삭제에 실패했습니다.");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const renderExpandedRow = (p: Project) => {
    const filesLoading = !!filesLoadingMap[p.id];
    const projectFiles = projectFilesMap[p.id] ?? [];
    const individualFiles = projectFiles.filter((f) => (f.file_type ?? "").trim() === "개별문항");
    const target = (p as any).target_individual_items_count ?? 20;

    if (filesLoading) return <div className="text-gray-500 text-xs">불러오는 중...</div>;

    // 콘텐츠 업로드와 동일 구조: 세트별로 파일 행 나열, 세트 번호는 rowSpan으로 묶음
    type RowItem = { setIndex: number; file: FileAsset };
    const rows: RowItem[] = [];
    for (let setIndex = 1; setIndex <= target; setIndex++) {
      const pdfFile = pickBySetAndExt(individualFiles, setIndex, "pdf");
      const hwpFile = pickBySetAndExt(individualFiles, setIndex, "hwp");
      if (pdfFile) rows.push({ setIndex, file: pdfFile });
      if (hwpFile) rows.push({ setIndex, file: hwpFile });
    }

    const setIndexToRowSpan: Record<number, number> = {};
    for (const { setIndex } of rows) {
      setIndexToRowSpan[setIndex] = (setIndexToRowSpan[setIndex] ?? 0) + 1;
    }

    const cellTight = "px-3 py-0.5 leading-none";

    return (
      <table className="min-w-full text-xs border">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-3 py-2 text-left w-28">세트 번호</th>
            <th className="px-3 py-2 text-left">파일명</th>
            <th className="px-3 py-2 text-left w-44">검토상태</th>
            <th className="px-3 py-2 text-left w-20">확장자</th>
            <th className="px-3 py-2 text-left w-28">업로드일</th>
            <th className="px-3 py-2 text-right w-36 whitespace-nowrap">선택</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-gray-400">
                개별 문항 파일이 없습니다.
              </td>
            </tr>
          ) : (
            rows.map(({ setIndex, file }, idx) => {
              const isFirstRowOfSet = idx === 0 || rows[idx - 1].setIndex !== setIndex;
              const rowSpan = setIndexToRowSpan[setIndex];
              const isPdf = extLowerFromName(file.original_name ?? "") === "pdf";

              return (
                <tr key={`${p.id}-${setIndex}-${file.id}`} className={idx === 0 ? "" : "border-t"}>
                  {isFirstRowOfSet ? (
                    <td
                      rowSpan={rowSpan}
                      className={[
                        "pl-4 pr-3 py-0.5 leading-none",
                        "w-28",
                        "align-middle",
                        "text-left",
                        "font-semibold",
                        "text-gray-900",
                        "bg-gray-50",
                      ].join(" ")}
                    >
                      {setIndex}
                    </td>
                  ) : null}

                  <td className={cellTight}>{file.original_name}</td>

                  <td
                    className={[
                      cellTight,
                      "w-44",
                      !isPdf ? "text-center" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {isPdf ? (
                      <ReviewStatusCell
                        fileId={file.id}
                        summary={fileReviewSessionsByFileId[file.id]}
                        onOpenPdf={(opts) => void openReadonlyPdfInNewTab(file.id, opts)}
                      />
                    ) : (
                      <span className="inline-block text-gray-400 -ml-1" title="검토 대상 아님">
                        -
                      </span>
                    )}
                  </td>

                  <td className={`${cellTight} text-gray-700 w-20`}>{getFileExt(file.original_name)}</td>

                  <td className={`${cellTight} w-28`}>{file.created_at?.split("T")[0] ?? ""}</td>

                  <td className={`${cellTight} text-right w-36 pr-4`}>
                    <div className="inline-flex items-center justify-end gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded-md border-gray-300"
                        checked={getSelectedSet(p.id).has(file.id)}
                        onChange={() => toggleSelected(p.id, file.id)}
                        title="선택"
                      />
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    );
  };

  return (
    <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">개별 문항 업로드</h1>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            onClick={() => void bulkDeleteGlobal()}
            disabled={globalSelectedCount === 0 || bulkBusy}
          >
            {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {isBulkDeleting ? `삭제 중... (${globalSelectedCount})` : `삭제 (${globalSelectedCount})`}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            onClick={() => void bulkDownloadZipGlobal()}
            disabled={globalSelectedCount === 0 || bulkBusy}
          >
            {isBulkDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isBulkDownloading ? `다운로드 중...` : `다운로드 (${globalSelectedCount})`}
          </button>
        </div>
      </div>

      {listLoading && <div className="text-gray-500 text-sm">프로젝트 목록을 불러오는 중입니다...</div>}
      {error && <div className="text-red-500 text-sm">{error}</div>}

      <ProjectListTable
        title="프로젝트 목록"
        projects={projects}
        years={years}
        subjects={subjects}
        viewOptions={viewOptions as any}
        actionHeader="업로드"
        renderAction={(p) => <UploadButton onClick={() => void openUploadModal(p)} />}
        leadingHeader=""
        renderLeadingCell={(p) => <span className="select-none">{expandedProjectIds.has(p.id) ? "▾" : "▸"}</span>}
        renderBeforeAction={(p) => {
          const current = individualItemsCountMap[p.id] ?? 0;
          const target = (p as any).target_individual_items_count ?? 20;
          return (
            <span className="text-sm font-medium text-indigo-600">
              {current}/{target}
            </span>
          );
        }}
        isExpanded={(p) => expandedProjectIds.has(p.id)}
        onToggleExpand={handleToggleExpand}
        renderExpandedRow={renderExpandedRow}
        pageSize={10}
      />

      {isUploadModalOpen && modalProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl bg-white p-6 flex flex-col">
            <div>
              <h2 className="text-lg font-semibold">개별 문항 업로드</h2>
              <div className="mt-1 text-sm text-gray-600">
                {modalProject.year} / {modalProject.subject} / {modalProject.name}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                현재 업로드된 세트: {individualItemsCountMap[modalProject.id] ?? 0}/
                {(modalProject as any).target_individual_items_count ?? 20} (PDF+HWP 모두 있는 세트만 카운트)
              </div>
            </div>

            <div className="mt-4 flex-1 min-h-0 overflow-y-auto space-y-4">
              {Array.from({ length: (modalProject as any).target_individual_items_count ?? 20 }, (_, i) => i + 1).map(
                (setIndex) => {
                  const slots = queuedSlotsBySetIndex[setIndex];
                  return (
                    <div key={setIndex} className="rounded-2xl border p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-900">세트 {setIndex}</div>
                        <div className="text-xs text-gray-500">PDF / HWP</div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-xl border p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-xs font-semibold text-gray-700">PDF</div>
                            {slots?.pdf.existing ? (
                              <button
                                type="button"
                                className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                                onClick={() => void deleteExistingSlotFile(setIndex, "pdf")}
                                disabled={batchUploading}
                              >
                                삭제
                              </button>
                            ) : slots?.pdf.queued ? (
                              <button
                                type="button"
                                className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                                onClick={() => removeQueuedSlotFile(setIndex, "pdf")}
                                disabled={batchUploading}
                              >
                                제거
                              </button>
                            ) : null}
                          </div>
                          {slots?.pdf.existing ? (
                            <div className="rounded-md border px-2 py-1">
                              <div className="truncate text-xs text-gray-800">{slots.pdf.existing.original_name}</div>
                              <div className="text-[11px] text-gray-500">이미 업로드됨</div>
                            </div>
                          ) : slots?.pdf.queued ? (
                            <div className="rounded-md border px-2 py-1">
                              <div className="truncate text-xs text-gray-800">{slots.pdf.queued.name}</div>
                              <div className="text-[11px] text-gray-500">업로드 대기</div>
                            </div>
                          ) : (
                            <UploadDropzone
                              compact
                              accept=".pdf"
                              multiple={false}
                              disabled={batchUploading}
                              showLastAdded={false}
                              showHintText={false}
                              onReject={(m) => reject(m)}
                              onFiles={(files) => setQueuedSlotFile(setIndex, "pdf", files[0])}
                            />
                          )}
                        </div>

                        <div className="rounded-xl border p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-xs font-semibold text-gray-700">HWP</div>
                            {slots?.hwp.existing ? (
                              <button
                                type="button"
                                className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                                onClick={() => void deleteExistingSlotFile(setIndex, "hwp")}
                                disabled={batchUploading}
                              >
                                삭제
                              </button>
                            ) : slots?.hwp.queued ? (
                              <button
                                type="button"
                                className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                                onClick={() => removeQueuedSlotFile(setIndex, "hwp")}
                                disabled={batchUploading}
                              >
                                제거
                              </button>
                            ) : null}
                          </div>
                          {slots?.hwp.existing ? (
                            <div className="rounded-md border px-2 py-1">
                              <div className="truncate text-xs text-gray-800">{slots.hwp.existing.original_name}</div>
                              <div className="text-[11px] text-gray-500">이미 업로드됨</div>
                            </div>
                          ) : slots?.hwp.queued ? (
                            <div className="rounded-md border px-2 py-1">
                              <div className="truncate text-xs text-gray-800">{slots.hwp.queued.name}</div>
                              <div className="text-[11px] text-gray-500">업로드 대기</div>
                            </div>
                          ) : (
                            <UploadDropzone
                              compact
                              accept=".hwp"
                              multiple={false}
                              disabled={batchUploading}
                              showLastAdded={false}
                              showHintText={false}
                              onReject={(m) => reject(m)}
                              onFiles={(files) => setQueuedSlotFile(setIndex, "hwp", files[0])}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
              )}
            </div>

            {uploadError && <div className="mt-3 whitespace-pre-line text-red-500 text-xs">{uploadError}</div>}
            {uploadSuccess && <div className="text-green-600 text-xs mt-3">{uploadSuccess}</div>}

            <div className="mt-4 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                onClick={closeUploadModal}
                disabled={batchUploading}
              >
                닫기
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                onClick={handleBatchUpload}
                disabled={batchUploading || totalQueuedCount === 0}
              >
                {batchUploading ? "업로드 중..." : `업로드 (${totalQueuedCount})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function UploadButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="p-1.5 text-gray-600 hover:text-indigo-600" title="Upload">
      <Upload className="h-4 w-4" />
    </button>
  );
}
