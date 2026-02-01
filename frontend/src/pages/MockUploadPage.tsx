import React, { useMemo, useState, useEffect } from "react";
import { Upload, Download, Trash2, Loader2 } from "lucide-react";
import { getAuthedUser } from "@/auth";
import {
  fetchProjects,
  getProjectFiles,
  uploadProjectFile,
  Project,
  FileAsset,
  deleteProjectFile,
  getFileDownloadUrl,
  listContentFilesForReview,
  type Review,
} from "../data/files/api";

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

function uniqByNameSize(files: File[]) {
  const map = new Map<string, File>();
  for (const f of files) map.set(`${f.name}__${f.size}`, f);
  return Array.from(map.values());
}

type SlotState = {
  existing: FileAsset | null; // already uploaded on server
  queued: File | null; // newly selected in modal
};

type SlotPairState = { pdf: SlotState; hwp: SlotState };

function isRestrictedType(t: string) {
  return t !== "기타";
}

function extLowerFromName(name: string) {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i + 1).toLowerCase();
}

function pickLatestByExt(files: FileAsset[], ext: "pdf" | "hwp"): FileAsset | null {
  const filtered = files.filter((f) => extLowerFromName(f.original_name ?? "") === ext);
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => {
    const at = a.created_at ?? "";
    const bt = b.created_at ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
  return filtered[0];
}

function getReviewStatusLabel(status?: string | null) {
  switch (status) {
    case "approved":
      return "검토완료";
    case "request_revision":
      return "수정요청";
    case "in_progress":
      return "검토중";
    default:
      return "대기중";
  }
}

function getReviewStatusBadgeClass(status?: string | null) {
  switch (status) {
    case "approved":
      return "bg-green-100 text-green-800";
    case "request_revision":
      return "bg-red-100 text-red-800";
    case "in_progress":
      return "bg-yellow-100 text-yellow-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
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
export default function MockUploadPage() {
  const years = useMemo(() => ["전체", "2025", "2026", "2027"], []);
  // ✅ 9 subjects (labels). We normalize project.subject to label when loading.
  const subjects = useMemo(() => ["전체", ...DEPARTMENTS.map((d) => DEPARTMENT_LABEL[d])], []);
  const viewOptions = useMemo(() => ["진행중인 프로젝트만", "모두 보기"], []);
  const fileTypeOptions = useMemo(() => ["문제지", "해설지", "정오표", "기타"], []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(() => new Set());

  const [projectFilesMap, setProjectFilesMap] = useState<Record<number, FileAsset[]>>({});
  const [filesLoadingMap, setFilesLoadingMap] = useState<Record<number, boolean>>({});

  // ✅ file_asset_id -> review status (pending/in_progress/request_revision/approved)
  const [reviewStatusByFileId, setReviewStatusByFileId] = useState<Record<number, string>>({});

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [modalProject, setModalProject] = useState<Project | null>(null);

  const [queuedSlotsByType, setQueuedSlotsByType] = useState<Record<string, SlotPairState>>({});
  const [queuedMiscFiles, setQueuedMiscFiles] = useState<File[]>([]);
  const [batchUploading, setBatchUploading] = useState(false);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // ✅ selection for global bulk actions (across projects)
  const [selectedFileIdsByProject, setSelectedFileIdsByProject] = useState<Record<number, Set<number>>>({});

  // ✅ bulk action loading states
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

  const clearAllSelection = () => {
    setSelectedFileIdsByProject({});
  };

  const getAllSelectedPairs = useMemo(() => {
    const pairs: Array<{ projectId: number; file: FileAsset }> = [];
    for (const [pidStr, sel] of Object.entries(selectedFileIdsByProject)) {
      const projectId = Number(pidStr);
      if (!sel || sel.size === 0) continue;
      const files = projectFilesMap[projectId] ?? [];
      for (const f of files) {
        if (sel.has(f.id)) pairs.push({ projectId, file: f });
      }
    }
    return pairs;
  }, [projectFilesMap, selectedFileIdsByProject]);

  const globalSelectedCount = getAllSelectedPairs.length;
  const bulkBusy = isBulkDownloading || isBulkDeleting;

  const bulkDownloadZipGlobal = async () => {
    if (globalSelectedCount === 0) return;
    if (bulkBusy) return;

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

      if (!res.ok) {
        throw new Error(`bulk-download failed: ${res.status}`);
      }

      const blob = await res.blob();
      await downloadBlobAsFile(blob, formatZipNameByDate());
    } catch (e) {
      console.error(e);

      // fallback (temporary): per-file download url
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
    if (globalSelectedCount === 0) return;
    if (bulkBusy) return;

    if (!window.confirm(`선택한 파일 ${globalSelectedCount}개를 삭제하시겠습니까?`)) return;

    setIsBulkDeleting(true);
    try {
      await Promise.all(getAllSelectedPairs.map((x) => deleteProjectFile(x.projectId, x.file.id)));

      // reload expanded projects (so UI stays consistent)
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

  /* ---------- global drag/drop prevent (drop outside => browser open) ---------- */
  useEffect(() => {
    if (!isUploadModalOpen) return;

    const prevent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, [isUploadModalOpen]);

  /* ---------- data load ---------- */
  const refreshReviewStatuses = async () => {
    try {
      const data: Review[] = await listContentFilesForReview();
      const next: Record<number, string> = {};
      for (const r of data) {
        if (typeof r.file_asset_id === "number") next[r.file_asset_id] = r.status;
      }
      setReviewStatusByFileId(next);
    } catch (e) {
      // If user lacks permission or endpoint fails, keep UI usable without status.
      console.warn("Failed to load review statuses", e);
    }
  };

  const loadProjects = async () => {
    try {
      setListLoading(true);
      setError(null);
      const data = await fetchProjects();

      // ✅ Normalize subject(code) -> Korean label for this page (table filter/display)
      const normalized = data.map((p) => ({
        ...p,
        subject: prettyDepartment((p as any).subject),
      })) as Project[];

      setProjects(normalized);
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
      return files;
    } catch {
      setProjectFilesMap((prev) => ({ ...prev, [projectId]: [] }));
      setSelectedFileIdsByProject((prev) => ({ ...prev, [projectId]: new Set<number>() }));
      return [] as FileAsset[];
    } finally {
      setFilesLoadingMap((prev) => ({ ...prev, [projectId]: false }));
    }
  };

  useEffect(() => {
    void loadProjects();
    void refreshReviewStatuses();
  }, []);

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

    const initSlots: Record<string, SlotPairState> = {};
    for (const t of fileTypeOptions) {
      if (!isRestrictedType(t)) continue;
      const filesForType = files.filter((f) => (f.file_type ?? "").trim() === t);
      initSlots[t] = {
        pdf: { existing: pickLatestByExt(filesForType, "pdf"), queued: null },
        hwp: { existing: pickLatestByExt(filesForType, "hwp"), queued: null },
      };
    }

    setQueuedSlotsByType(initSlots);
    setQueuedMiscFiles([]);
    setIsUploadModalOpen(true);
  };

  const closeUploadModal = () => {
    if (batchUploading) return;
    setIsUploadModalOpen(false);
    setModalProject(null);
    setQueuedSlotsByType({});
    setQueuedMiscFiles([]);
    clearMsg();
  };

  /* ---------- slot ops ---------- */
  const setQueuedSlotFile = (t: string, kind: "pdf" | "hwp", file: File) => {
    clearMsg();
    setQueuedSlotsByType((prev) => {
      const cur = prev[t];
      if (!cur) return prev;

      if (cur[kind].existing) {
        reject(`이미 업로드된 ${t} ${kind.toUpperCase()} 파일이 있습니다. 삭제 후 업로드하세요.`);
        return prev;
      }
      if (cur[kind].queued) {
        reject(`${t} ${kind.toUpperCase()} 슬롯은 이미 선택되어 있습니다. 먼저 제거 후 다시 넣어주세요.`);
        return prev;
      }

      return {
        ...prev,
        [t]: { ...cur, [kind]: { ...cur[kind], queued: file } },
      };
    });
  };

  const removeQueuedSlotFile = (t: string, kind: "pdf" | "hwp") => {
    setQueuedSlotsByType((prev) => {
      const cur = prev[t];
      if (!cur) return prev;
      return { ...prev, [t]: { ...cur, [kind]: { ...cur[kind], queued: null } } };
    });
  };

  const deleteExistingSlotFile = async (t: string, kind: "pdf" | "hwp") => {
    if (!modalProject) return;
    const cur = queuedSlotsByType[t];
    const existing = cur?.[kind].existing;
    if (!existing) return;

    if (!window.confirm("정말로 이 파일을 삭제하시겠습니까?")) return;

    clearMsg();
    try {
      await deleteProjectFile(modalProject.id, existing.id);

      const files = await loadProjectFiles(modalProject.id);
      const filesForType = files.filter((f) => (f.file_type ?? "").trim() === t);

      setQueuedSlotsByType((prev) => {
        const c = prev[t];
        if (!c) return prev;
        return {
          ...prev,
          [t]: {
            pdf: { existing: pickLatestByExt(filesForType, "pdf"), queued: c.pdf.queued },
            hwp: { existing: pickLatestByExt(filesForType, "hwp"), queued: c.hwp.queued },
          },
        };
      });

      setUploadSuccess("삭제 완료");
      await refreshReviewStatuses();
    } catch {
      reject("파일 삭제에 실패했습니다.");
    }
  };

  /* ---------- misc ops ---------- */
  const addMiscFiles = (files: File[]) => {
    clearMsg();
    setQueuedMiscFiles((prev) => uniqByNameSize([...prev, ...files]));
  };

  const removeMiscFile = (idx: number) => {
    setQueuedMiscFiles((prev) => prev.slice(0, idx).concat(prev.slice(idx + 1)));
  };

  const totalQueuedCount = useMemo(() => {
    let n = queuedMiscFiles.length;
    for (const t of fileTypeOptions) {
      if (!isRestrictedType(t)) continue;
      const s = queuedSlotsByType[t];
      if (s?.pdf.queued) n += 1;
      if (s?.hwp.queued) n += 1;
    }
    return n;
  }, [fileTypeOptions, queuedMiscFiles, queuedSlotsByType]);

  /* ---------- batch upload ---------- */
  const handleBatchUpload = async () => {
    if (!modalProject) return;

    if (totalQueuedCount === 0) {
      reject("업로드할 파일을 추가하세요.");
      return;
    }

    clearMsg();
    setBatchUploading(true);

    try {
      for (const t of fileTypeOptions) {
        if (!isRestrictedType(t)) continue;
        const s = queuedSlotsByType[t];
        if (!s) continue;

        if (s.pdf.queued) await uploadProjectFile(modalProject.id, s.pdf.queued, t);
        if (s.hwp.queued) await uploadProjectFile(modalProject.id, s.hwp.queued, t);
      }

      for (const f of queuedMiscFiles) {
        await uploadProjectFile(modalProject.id, f, "기타");
      }

      setUploadSuccess("업로드 성공!");

      const files = await loadProjectFiles(modalProject.id);
      await refreshReviewStatuses();

      const nextSlots: Record<string, SlotPairState> = {};
      for (const t of fileTypeOptions) {
        if (!isRestrictedType(t)) continue;
        const filesForType = files.filter((f) => (f.file_type ?? "").trim() === t);
        nextSlots[t] = {
          pdf: { existing: pickLatestByExt(filesForType, "pdf"), queued: null },
          hwp: { existing: pickLatestByExt(filesForType, "hwp"), queued: null },
        };
      }

      setQueuedSlotsByType(nextSlots);
      setQueuedMiscFiles([]);

      if (expandedProjectIds.has(modalProject.id)) {
        await loadProjectFiles(modalProject.id);
      }
    } catch {
      reject("업로드 실패");
    } finally {
      setBatchUploading(false);
    }
  };

  /* ---------- file table (expanded) ---------- */
  const renderExpandedRow = (p: Project) => {
    const filesLoading = !!filesLoadingMap[p.id];
    const projectFiles = projectFilesMap[p.id] ?? [];

    // ✅ 개별문항 파일은 모의고사 업로드 페이지에서 제외
    const filteredFiles = projectFiles.filter((f) => (f.file_type ?? "").trim() !== "개별문항");

    const grouped = new Map<string, FileAsset[]>();
    for (const t of fileTypeOptions) grouped.set(t, []);

    const unknown: FileAsset[] = [];
    for (const f of filteredFiles) {
      const t = (f.file_type ?? "").trim();
      if (t && grouped.has(t)) grouped.get(t)!.push(f);
      else unknown.push(f);
    }

    for (const t of fileTypeOptions) grouped.get(t)!.sort((a, b) => (a.id < b.id ? 1 : -1));
    unknown.sort((a, b) => (a.id < b.id ? 1 : -1));

    const orderedTypes = unknown.length > 0 ? [...fileTypeOptions, "__UNKNOWN__"] : [...fileTypeOptions];

    if (filesLoading) return <div className="text-gray-500 text-xs">불러오는 중...</div>;

    return (
      <table className="min-w-full text-xs border">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-3 py-2 text-left w-28">파일 타입</th>
            <th className="px-3 py-2 text-left">파일명</th>
            <th className="px-3 py-2 text-left w-24">검토상태</th>
            <th className="px-3 py-2 text-left w-20">확장자</th>
            <th className="px-3 py-2 text-left w-28">업로드일</th>
            <th className="px-3 py-2 text-right w-36 whitespace-nowrap">선택</th>
          </tr>
        </thead>

        <tbody>
          {orderedTypes.flatMap((t) => {
            const isUnknown = t === "__UNKNOWN__";
            const filesForType = isUnknown ? unknown : grouped.get(t) ?? [];
            const rows: Array<FileAsset | null> = !isUnknown && filesForType.length === 0 ? [null] : filesForType;

            return rows.map((f, idx) => {
              const isPlaceholder = f == null;

              const shouldRenderTypeCell = !isUnknown && idx === 0;
              const typeRowSpan = !isUnknown ? rows.length : 1;

              const trBorderClass = idx === 0 ? "border-t" : "";
              const cellTight = "px-3 py-0.5 leading-none";

              return (
                <tr key={`${p.id}-${t}-${f?.id ?? "empty"}-${idx}`} className={trBorderClass}>
                  {shouldRenderTypeCell ? (
                    <td
                      rowSpan={typeRowSpan}
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
                      {t}
                    </td>
                  ) : null}

                  {isUnknown ? <td className={`${cellTight} w-28`} /> : null}

                  <td className={cellTight}>
                    {isPlaceholder ? <span className="text-gray-300"> </span> : f.original_name}
                  </td>

                  <td className={`${cellTight} w-24`}>
                    {isPlaceholder ? (
                      ""
                    ) : (
                      <a
                        href={`/reviews?file_asset_id=${f.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className={[
                          "inline-flex items-center rounded-full px-2 py-0.5",
                          "text-[11px] font-semibold",
                          "hover:underline cursor-pointer",
                          getReviewStatusBadgeClass(reviewStatusByFileId[f.id]),
                        ].join(" ")}
                        title="새 탭에서 검토 페이지 열기"
                      >
                        {getReviewStatusLabel(reviewStatusByFileId[f.id])}
                      </a>
                    )}
                  </td>

                  <td className={`${cellTight} text-gray-700 w-20`}>
                    {isPlaceholder ? "" : getFileExt(f.original_name)}
                  </td>

                  <td className={`${cellTight} w-28`}>{isPlaceholder ? "" : f.created_at?.split("T")[0] ?? ""}</td>

                  <td className={`${cellTight} text-right w-36 pr-4`}>
                    {isPlaceholder ? (
                      <span className="text-gray-300"> </span>
                    ) : (
                      <div className="inline-flex items-center justify-end gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded-md border-gray-300"
                          checked={getSelectedSet(p.id).has(f.id)}
                          onChange={() => toggleSelected(p.id, f.id)}
                          title="선택"
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">콘텐츠 업로드</h1>

        {/* ✅ Global bulk actions (outside table) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            onClick={() => void bulkDeleteGlobal()}
            disabled={globalSelectedCount === 0 || bulkBusy}
            title={
              globalSelectedCount
                ? bulkBusy
                  ? "처리 중..."
                  : `선택 ${globalSelectedCount}개 삭제`
                : "선택된 파일이 없습니다"
            }
          >
            {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {isBulkDeleting ? `삭제 중... (${globalSelectedCount})` : `삭제 (${globalSelectedCount})`}
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            onClick={() => void bulkDownloadZipGlobal()}
            disabled={globalSelectedCount === 0 || bulkBusy}
            title={
              globalSelectedCount
                ? bulkBusy
                  ? "처리 중..."
                  : `선택 ${globalSelectedCount}개 ZIP 다운로드`
                : "선택된 파일이 없습니다"
            }
          >
            {isBulkDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isBulkDownloading ? `다운로드 중... (${globalSelectedCount})` : `다운로드 (${globalSelectedCount})`}
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
        isExpanded={(p) => expandedProjectIds.has(p.id)}
        onToggleExpand={handleToggleExpand}
        renderExpandedRow={renderExpandedRow}
        pageSize={10}
      />

      {isUploadModalOpen && modalProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6">
            <div>
              <h2 className="text-lg font-semibold">파일 업로드</h2>
              <div className="mt-1 text-sm text-gray-600">
                {modalProject.year} / {modalProject.subject} / {modalProject.name}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                문제지/해설지/정오표는 PDF/HWP 각각 1개만 업로드 가능(단독 업로드 가능). 기타는 제한 없음.
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              {fileTypeOptions.map((t) => {
                if (t === "기타") {
                  return (
                    <div key={t} className="rounded-2xl border p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-900">기타</div>
                        <div className="text-xs text-gray-500">{queuedMiscFiles.length}개</div>
                      </div>

                      <UploadDropzone
                        compact
                        accept=""
                        multiple
                        disabled={batchUploading}
                        showLastAdded={false}
                        showHintText={false}
                        onReject={(m) => reject(m)}
                        onFiles={(files) => addMiscFiles(files)}
                      />

                      {queuedMiscFiles.length > 0 && (
                        <div className="mt-3 space-y-1">
                          {queuedMiscFiles.map((f, idx) => (
                            <div
                              key={`${f.name}-${f.size}-${idx}`}
                              className="flex items-center justify-between rounded-md border px-2 py-1"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs text-gray-800">{f.name}</div>
                                <div className="text-[11px] text-gray-500">
                                  {getFileExt(f.name)} • {f.size.toLocaleString()} bytes
                                </div>
                              </div>
                              <button
                                type="button"
                                className="ml-2 p-1 text-gray-500 hover:text-red-600 disabled:opacity-50"
                                onClick={() => removeMiscFile(idx)}
                                disabled={batchUploading}
                                title="Remove"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                const slots = queuedSlotsByType[t];

                return (
                  <div key={t} className="rounded-2xl border p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">{t}</div>
                      <div className="text-xs text-gray-500">PDF / HWP</div>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      {/* PDF slot */}
                      <div className="rounded-xl border p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-xs font-semibold text-gray-700">PDF</div>
                          {slots?.pdf.existing ? (
                            <button
                              type="button"
                              className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                              onClick={() => void deleteExistingSlotFile(t, "pdf")}
                              disabled={batchUploading}
                            >
                              삭제
                            </button>
                          ) : slots?.pdf.queued ? (
                            <button
                              type="button"
                              className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                              onClick={() => removeQueuedSlotFile(t, "pdf")}
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
                            onFiles={(files) => setQueuedSlotFile(t, "pdf", files[0])}
                          />
                        )}
                      </div>

                      {/* HWP slot */}
                      <div className="rounded-xl border p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-xs font-semibold text-gray-700">HWP</div>
                          {slots?.hwp.existing ? (
                            <button
                              type="button"
                              className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                              onClick={() => void deleteExistingSlotFile(t, "hwp")}
                              disabled={batchUploading}
                            >
                              삭제
                            </button>
                          ) : slots?.hwp.queued ? (
                            <button
                              type="button"
                              className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                              onClick={() => removeQueuedSlotFile(t, "hwp")}
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
                            onFiles={(files) => setQueuedSlotFile(t, "hwp", files[0])}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {uploadError && <div className="mt-3 whitespace-pre-line text-red-500 text-xs">{uploadError}</div>}
            {uploadSuccess && <div className="text-green-600 text-xs mt-3">{uploadSuccess}</div>}

            <div className="mt-5 flex items-center justify-end gap-2">
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

/* ---------- icon buttons ---------- */
export function UploadButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="p-1.5 text-gray-600 hover:text-indigo-600" title="Upload">
      <Upload className="h-4 w-4" />
    </button>
  );
}


// // frontend/src/pages/MockUploadPage.tsx
// import React, { useMemo, useState, useEffect } from "react";
// import { Upload, Download, Trash2, Loader2 } from "lucide-react";
// import { getFileDownloadUrl } from "../data/files/api";
// import {
//   fetchProjects,
//   getProjectFiles,
//   uploadProjectFile,
//   Project,
//   FileAsset,
//   deleteProjectFile,
// } from "../data/files/api";

// import ProjectListTable from "@/components/projects/ProjectListTable";
// import UploadDropzone from "@/components/files/UploadDropzone";

// /* ---------- helpers ---------- */
// function getFileExt(filename?: string | null) {
//   if (!filename) return "";
//   const idx = filename.lastIndexOf(".");
//   if (idx === -1) return "";
//   return filename.slice(idx + 1).toUpperCase();
// }

// function uniqByNameSize(files: File[]) {
//   const map = new Map<string, File>();
//   for (const f of files) map.set(`${f.name}__${f.size}`, f);
//   return Array.from(map.values());
// }

// type SlotState = {
//   existing: FileAsset | null; // already uploaded on server
//   queued: File | null; // newly selected in modal
// };

// type SlotPairState = { pdf: SlotState; hwp: SlotState };

// function isRestrictedType(t: string) {
//   return t !== "기타";
// }

// function extLowerFromName(name: string) {
//   const i = name.lastIndexOf(".");
//   if (i < 0) return "";
//   return name.slice(i + 1).toLowerCase();
// }

// function pickLatestByExt(files: FileAsset[], ext: "pdf" | "hwp"): FileAsset | null {
//   const filtered = files.filter((f) => extLowerFromName(f.original_name ?? "") === ext);
//   if (filtered.length === 0) return null;
//   filtered.sort((a, b) => {
//     const at = a.created_at ?? "";
//     const bt = b.created_at ?? "";
//     if (at !== bt) return at < bt ? 1 : -1;
//     return a.id < b.id ? 1 : -1;
//   });
//   return filtered[0];
// }

// function getBaseUrl(): string {
//   const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
//   if (!baseUrl) throw new Error("VITE_API_BASE_URL is not set");
//   return baseUrl.replace(/\/+$/, "");
// }

// function formatZipNameByDate(): string {
//   const yyyyMmDd = new Date().toISOString().slice(0, 10);
//   return `files_${yyyyMmDd}.zip`;
// }

// async function downloadBlobAsFile(blob: Blob, filename: string) {
//   const url = window.URL.createObjectURL(blob);
//   try {
//     const a = document.createElement("a");
//     a.href = url;
//     a.download = filename;
//     document.body.appendChild(a);
//     a.click();
//     a.remove();
//   } finally {
//     window.URL.revokeObjectURL(url);
//   }
// }

// /* ---------- main page ---------- */
// export default function MockUploadPage() {
//   const years = useMemo(() => ["전체", "2025", "2026", "2027"], []);
//   const subjects = useMemo(() => ["전체", "물리", "화학", "지구과학"], []);
//   const viewOptions = useMemo(() => ["진행중인 프로젝트만", "모두 보기"], []);
//   const fileTypeOptions = useMemo(() => ["문제지", "해설지", "정오표", "기타"], []);

//   const [projects, setProjects] = useState<Project[]>([]);
//   const [listLoading, setListLoading] = useState(false);
//   const [error, setError] = useState<string | null>(null);

//   const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(() => new Set());

//   const [projectFilesMap, setProjectFilesMap] = useState<Record<number, FileAsset[]>>({});
//   const [filesLoadingMap, setFilesLoadingMap] = useState<Record<number, boolean>>({});

//   const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
//   const [modalProject, setModalProject] = useState<Project | null>(null);

//   const [queuedSlotsByType, setQueuedSlotsByType] = useState<Record<string, SlotPairState>>({});
//   const [queuedMiscFiles, setQueuedMiscFiles] = useState<File[]>([]);
//   const [batchUploading, setBatchUploading] = useState(false);

//   const [uploadError, setUploadError] = useState<string | null>(null);
//   const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

//   // ✅ selection for global bulk actions (across projects)
//   const [selectedFileIdsByProject, setSelectedFileIdsByProject] = useState<Record<number, Set<number>>>({});

//   // ✅ bulk action loading states
//   const [isBulkDownloading, setIsBulkDownloading] = useState(false);
//   const [isBulkDeleting, setIsBulkDeleting] = useState(false);

//   const getSelectedSet = (projectId: number) => selectedFileIdsByProject[projectId] ?? new Set<number>();

//   const setSelectedSet = (projectId: number, next: Set<number>) => {
//     setSelectedFileIdsByProject((prev) => ({ ...prev, [projectId]: next }));
//   };

//   const toggleSelected = (projectId: number, fileId: number) => {
//     const next = new Set(getSelectedSet(projectId));
//     if (next.has(fileId)) next.delete(fileId);
//     else next.add(fileId);
//     setSelectedSet(projectId, next);
//   };

//   const pruneSelection = (projectId: number, files: FileAsset[]) => {
//     setSelectedFileIdsByProject((prev) => {
//       const cur = prev[projectId];
//       if (!cur || cur.size === 0) return prev;

//       const alive = new Set(files.map((f) => f.id));
//       const next = new Set<number>();
//       cur.forEach((id) => {
//         if (alive.has(id)) next.add(id);
//       });

//       return { ...prev, [projectId]: next };
//     });
//   };

//   const clearAllSelection = () => {
//     setSelectedFileIdsByProject({});
//   };

//   const getAllSelectedPairs = useMemo(() => {
//     const pairs: Array<{ projectId: number; file: FileAsset }> = [];
//     for (const [pidStr, sel] of Object.entries(selectedFileIdsByProject)) {
//       const projectId = Number(pidStr);
//       if (!sel || sel.size === 0) continue;
//       const files = projectFilesMap[projectId] ?? [];
//       for (const f of files) {
//         if (sel.has(f.id)) pairs.push({ projectId, file: f });
//       }
//     }
//     return pairs;
//   }, [projectFilesMap, selectedFileIdsByProject]);

//   const globalSelectedCount = getAllSelectedPairs.length;
//   const bulkBusy = isBulkDownloading || isBulkDeleting;

//   const bulkDownloadZipGlobal = async () => {
//     if (globalSelectedCount === 0) return;
//     if (bulkBusy) return;

//     const fileIds = getAllSelectedPairs.map((x) => x.file.id);

//     setIsBulkDownloading(true);
//     try {
//       const res = await fetch(`${getBaseUrl()}/projects/files/bulk-download`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ file_ids: fileIds }),
//         credentials: "include",
//       });

//       if (!res.ok) {
//         throw new Error(`bulk-download failed: ${res.status}`);
//       }

//       const blob = await res.blob();
//       await downloadBlobAsFile(blob, formatZipNameByDate());
//     } catch (e) {
//       console.error(e);

//       // fallback (temporary): per-file download url
//       try {
//         for (const x of getAllSelectedPairs) {
//           const { url } = await getFileDownloadUrl(x.projectId, x.file.id);
//           window.open(url, "_blank");
//         }
//       } catch (e2) {
//         console.error(e2);
//         alert("다운로드에 실패했습니다.");
//       }
//     } finally {
//       setIsBulkDownloading(false);
//     }
//   };

//   const bulkDeleteGlobal = async () => {
//     if (globalSelectedCount === 0) return;
//     if (bulkBusy) return;

//     if (!window.confirm(`선택한 파일 ${globalSelectedCount}개를 삭제하시겠습니까?`)) return;

//     setIsBulkDeleting(true);
//     try {
//       await Promise.all(getAllSelectedPairs.map((x) => deleteProjectFile(x.projectId, x.file.id)));

//       // reload expanded projects (so UI stays consistent)
//       const expanded = Array.from(expandedProjectIds);
//       await Promise.all(expanded.map((pid) => loadProjectFiles(pid)));

//       clearAllSelection();
//     } catch (e) {
//       console.error(e);
//       alert("파일 삭제에 실패했습니다.");
//     } finally {
//       setIsBulkDeleting(false);
//     }
//   };

//   /* ---------- global drag/drop prevent (drop outside => browser open) ---------- */
//   useEffect(() => {
//     if (!isUploadModalOpen) return;

//     const prevent = (e: DragEvent) => {
//       e.preventDefault();
//       e.stopPropagation();
//     };

//     window.addEventListener("dragover", prevent);
//     window.addEventListener("drop", prevent);
//     return () => {
//       window.removeEventListener("dragover", prevent);
//       window.removeEventListener("drop", prevent);
//     };
//   }, [isUploadModalOpen]);

//   /* ---------- data load ---------- */
//   const loadProjects = async () => {
//     try {
//       setListLoading(true);
//       setError(null);
//       const data = await fetchProjects();
//       setProjects(data);
//     } catch {
//       setError("프로젝트 목록을 불러오는 데 실패했습니다.");
//     } finally {
//       setListLoading(false);
//     }
//   };

//   const loadProjectFiles = async (projectId: number) => {
//     try {
//       setFilesLoadingMap((prev) => ({ ...prev, [projectId]: true }));
//       const files = await getProjectFiles(projectId);
//       setProjectFilesMap((prev) => ({ ...prev, [projectId]: files }));
//       pruneSelection(projectId, files);
//       return files;
//     } catch {
//       setProjectFilesMap((prev) => ({ ...prev, [projectId]: [] }));
//       setSelectedFileIdsByProject((prev) => ({ ...prev, [projectId]: new Set<number>() }));
//       return [] as FileAsset[];
//     } finally {
//       setFilesLoadingMap((prev) => ({ ...prev, [projectId]: false }));
//     }
//   };

//   useEffect(() => {
//     void loadProjects();
//   }, []);

//   const handleToggleExpand = (p: Project) => {
//     setExpandedProjectIds((prev) => {
//       const next = new Set(prev);

//       if (next.has(p.id)) {
//         next.delete(p.id);
//         return next;
//       }

//       next.add(p.id);

//       const alreadyLoaded = Object.prototype.hasOwnProperty.call(projectFilesMap, p.id);
//       if (!alreadyLoaded) void loadProjectFiles(p.id);

//       return next;
//     });
//   };

//   const reject = (msg: string) => {
//     setUploadSuccess(null);
//     setUploadError(msg);
//   };

//   const clearMsg = () => {
//     setUploadError(null);
//     setUploadSuccess(null);
//   };

//   const openUploadModal = async (p: Project) => {
//     setModalProject(p);
//     clearMsg();

//     const files = await loadProjectFiles(p.id);

//     const initSlots: Record<string, SlotPairState> = {};
//     for (const t of fileTypeOptions) {
//       if (!isRestrictedType(t)) continue;
//       const filesForType = files.filter((f) => (f.file_type ?? "").trim() === t);
//       initSlots[t] = {
//         pdf: { existing: pickLatestByExt(filesForType, "pdf"), queued: null },
//         hwp: { existing: pickLatestByExt(filesForType, "hwp"), queued: null },
//       };
//     }

//     setQueuedSlotsByType(initSlots);
//     setQueuedMiscFiles([]);
//     setIsUploadModalOpen(true);
//   };

//   const closeUploadModal = () => {
//     if (batchUploading) return;
//     setIsUploadModalOpen(false);
//     setModalProject(null);
//     setQueuedSlotsByType({});
//     setQueuedMiscFiles([]);
//     clearMsg();
//   };

//   /* ---------- slot ops ---------- */
//   const setQueuedSlotFile = (t: string, kind: "pdf" | "hwp", file: File) => {
//     clearMsg();
//     setQueuedSlotsByType((prev) => {
//       const cur = prev[t];
//       if (!cur) return prev;

//       if (cur[kind].existing) {
//         reject(`이미 업로드된 ${t} ${kind.toUpperCase()} 파일이 있습니다. 삭제 후 업로드하세요.`);
//         return prev;
//       }
//       if (cur[kind].queued) {
//         reject(`${t} ${kind.toUpperCase()} 슬롯은 이미 선택되어 있습니다. 먼저 제거 후 다시 넣어주세요.`);
//         return prev;
//       }

//       return {
//         ...prev,
//         [t]: { ...cur, [kind]: { ...cur[kind], queued: file } },
//       };
//     });
//   };

//   const removeQueuedSlotFile = (t: string, kind: "pdf" | "hwp") => {
//     setQueuedSlotsByType((prev) => {
//       const cur = prev[t];
//       if (!cur) return prev;
//       return { ...prev, [t]: { ...cur, [kind]: { ...cur[kind], queued: null } } };
//     });
//   };

//   const deleteExistingSlotFile = async (t: string, kind: "pdf" | "hwp") => {
//     if (!modalProject) return;
//     const cur = queuedSlotsByType[t];
//     const existing = cur?.[kind].existing;
//     if (!existing) return;

//     if (!window.confirm("정말로 이 파일을 삭제하시겠습니까?")) return;

//     clearMsg();
//     try {
//       await deleteProjectFile(modalProject.id, existing.id);

//       const files = await loadProjectFiles(modalProject.id);
//       const filesForType = files.filter((f) => (f.file_type ?? "").trim() === t);

//       setQueuedSlotsByType((prev) => {
//         const c = prev[t];
//         if (!c) return prev;
//         return {
//           ...prev,
//           [t]: {
//             pdf: { existing: pickLatestByExt(filesForType, "pdf"), queued: c.pdf.queued },
//             hwp: { existing: pickLatestByExt(filesForType, "hwp"), queued: c.hwp.queued },
//           },
//         };
//       });

//       setUploadSuccess("삭제 완료");
//     } catch {
//       reject("파일 삭제에 실패했습니다.");
//     }
//   };

//   /* ---------- misc ops ---------- */
//   const addMiscFiles = (files: File[]) => {
//     clearMsg();
//     setQueuedMiscFiles((prev) => uniqByNameSize([...prev, ...files]));
//   };

//   const removeMiscFile = (idx: number) => {
//     setQueuedMiscFiles((prev) => prev.slice(0, idx).concat(prev.slice(idx + 1)));
//   };

//   const totalQueuedCount = useMemo(() => {
//     let n = queuedMiscFiles.length;
//     for (const t of fileTypeOptions) {
//       if (!isRestrictedType(t)) continue;
//       const s = queuedSlotsByType[t];
//       if (s?.pdf.queued) n += 1;
//       if (s?.hwp.queued) n += 1;
//     }
//     return n;
//   }, [fileTypeOptions, queuedMiscFiles, queuedSlotsByType]);

//   /* ---------- batch upload ---------- */
//   const handleBatchUpload = async () => {
//     if (!modalProject) return;

//     if (totalQueuedCount === 0) {
//       reject("업로드할 파일을 추가하세요.");
//       return;
//     }

//     clearMsg();
//     setBatchUploading(true);

//     try {
//       for (const t of fileTypeOptions) {
//         if (!isRestrictedType(t)) continue;
//         const s = queuedSlotsByType[t];
//         if (!s) continue;

//         if (s.pdf.queued) await uploadProjectFile(modalProject.id, s.pdf.queued, t);
//         if (s.hwp.queued) await uploadProjectFile(modalProject.id, s.hwp.queued, t);
//       }

//       for (const f of queuedMiscFiles) {
//         await uploadProjectFile(modalProject.id, f, "기타");
//       }

//       setUploadSuccess("업로드 성공!");

//       const files = await loadProjectFiles(modalProject.id);

//       const nextSlots: Record<string, SlotPairState> = {};
//       for (const t of fileTypeOptions) {
//         if (!isRestrictedType(t)) continue;
//         const filesForType = files.filter((f) => (f.file_type ?? "").trim() === t);
//         nextSlots[t] = {
//           pdf: { existing: pickLatestByExt(filesForType, "pdf"), queued: null },
//           hwp: { existing: pickLatestByExt(filesForType, "hwp"), queued: null },
//         };
//       }

//       setQueuedSlotsByType(nextSlots);
//       setQueuedMiscFiles([]);

//       if (expandedProjectIds.has(modalProject.id)) {
//         await loadProjectFiles(modalProject.id);
//       }
//     } catch {
//       reject("업로드 실패");
//     } finally {
//       setBatchUploading(false);
//     }
//   };

//   /* ---------- file table (expanded) ---------- */
//   const renderExpandedRow = (p: Project) => {
//     const filesLoading = !!filesLoadingMap[p.id];
//     const projectFiles = projectFilesMap[p.id] ?? [];

//     const grouped = new Map<string, FileAsset[]>();
//     for (const t of fileTypeOptions) grouped.set(t, []);

//     const unknown: FileAsset[] = [];
//     for (const f of projectFiles) {
//       const t = (f.file_type ?? "").trim();
//       if (t && grouped.has(t)) grouped.get(t)!.push(f);
//       else unknown.push(f);
//     }

//     for (const t of fileTypeOptions) grouped.get(t)!.sort((a, b) => (a.id < b.id ? 1 : -1));
//     unknown.sort((a, b) => (a.id < b.id ? 1 : -1));

//     const orderedTypes = unknown.length > 0 ? [...fileTypeOptions, "__UNKNOWN__"] : [...fileTypeOptions];

//     if (filesLoading) return <div className="text-gray-500 text-xs">불러오는 중...</div>;

//     return (
//       <table className="min-w-full text-xs border">
//         <thead className="bg-gray-100">
//           <tr>
//             <th className="px-3 py-2 text-left w-28">파일 타입</th>
//             <th className="px-3 py-2 text-left">파일명</th>
//             <th className="px-3 py-2 text-left w-20">확장자</th>
//             <th className="px-3 py-2 text-left w-28">업로드일</th>
//             <th className="px-3 py-2 text-right w-36 whitespace-nowrap">선택</th>
//           </tr>
//         </thead>

//         <tbody>
//           {orderedTypes.flatMap((t) => {
//             const isUnknown = t === "__UNKNOWN__";
//             const filesForType = isUnknown ? unknown : grouped.get(t) ?? [];
//             const rows: Array<FileAsset | null> = !isUnknown && filesForType.length === 0 ? [null] : filesForType;

//             return rows.map((f, idx) => {
//               const isPlaceholder = f == null;

//               const shouldRenderTypeCell = !isUnknown && idx === 0;
//               const typeRowSpan = !isUnknown ? rows.length : 1;

//               const trBorderClass = idx === 0 ? "border-t" : "";
//               const cellTight = "px-3 py-0.5 leading-none";

//               return (
//                 <tr key={`${p.id}-${t}-${f?.id ?? "empty"}-${idx}`} className={trBorderClass}>
//                   {shouldRenderTypeCell ? (
//                     <td
//                       rowSpan={typeRowSpan}
//                       className={[
//                         "pl-4 pr-3 py-0.5 leading-none",
//                         "w-28",
//                         "align-middle",
//                         "text-left",
//                         "font-semibold",
//                         "text-gray-900",
//                         "bg-gray-50",
//                       ].join(" ")}
//                     >
//                       {t}
//                     </td>
//                   ) : null}

//                   {isUnknown ? <td className={`${cellTight} w-28`} /> : null}

//                   <td className={cellTight}>
//                     {isPlaceholder ? <span className="text-gray-300"> </span> : f.original_name}
//                   </td>

//                   <td className={`${cellTight} text-gray-700 w-20`}>
//                     {isPlaceholder ? "" : getFileExt(f.original_name)}
//                   </td>

//                   <td className={`${cellTight} w-28`}>{isPlaceholder ? "" : f.created_at?.split("T")[0] ?? ""}</td>

//                   <td className={`${cellTight} text-right w-36 pr-4`}>
//                     {isPlaceholder ? (
//                       <span className="text-gray-300"> </span>
//                     ) : (
//                       <div className="inline-flex items-center justify-end gap-2">
//                         <input
//                           type="checkbox"
//                           className="h-4 w-4 rounded-md border-gray-300"
//                           checked={getSelectedSet(p.id).has(f.id)}
//                           onChange={() => toggleSelected(p.id, f.id)}
//                           title="선택"
//                         />
//                       </div>
//                     )}
//                   </td>
//                 </tr>
//               );
//             });
//           })}
//         </tbody>
//       </table>
//     );
//   };

//   return (
//     <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
//       <div className="flex items-start justify-between gap-3">
//         <h1 className="text-2xl font-bold tracking-tight">모의고사 업로드</h1>

//         {/* ✅ Global bulk actions (outside table) */}
//         <div className="flex items-center gap-2">
//           <button
//             type="button"
//             className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
//             onClick={() => void bulkDeleteGlobal()}
//             disabled={globalSelectedCount === 0 || bulkBusy}
//             title={
//               globalSelectedCount
//                 ? bulkBusy
//                   ? "처리 중..."
//                   : `선택 ${globalSelectedCount}개 삭제`
//                 : "선택된 파일이 없습니다"
//             }
//           >
//             {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
//             {isBulkDeleting ? `삭제 중... (${globalSelectedCount})` : `삭제 (${globalSelectedCount})`}
//           </button>

//           <button
//             type="button"
//             className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
//             onClick={() => void bulkDownloadZipGlobal()}
//             disabled={globalSelectedCount === 0 || bulkBusy}
//             title={
//               globalSelectedCount
//                 ? bulkBusy
//                   ? "처리 중..."
//                   : `선택 ${globalSelectedCount}개 ZIP 다운로드`
//                 : "선택된 파일이 없습니다"
//             }
//           >
//             {isBulkDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
//             {isBulkDownloading ? `다운로드 중... (${globalSelectedCount})` : `다운로드 (${globalSelectedCount})`}
//           </button>
//         </div>
//       </div>

//       {listLoading && <div className="text-gray-500 text-sm">프로젝트 목록을 불러오는 중입니다...</div>}
//       {error && <div className="text-red-500 text-sm">{error}</div>}

//       <ProjectListTable
//         title="프로젝트 목록"
//         projects={projects}
//         years={years}
//         subjects={subjects}
//         viewOptions={viewOptions as any}
//         actionHeader="업로드"
//         renderAction={(p) => <UploadButton onClick={() => void openUploadModal(p)} />}
//         leadingHeader=""
//         renderLeadingCell={(p) => <span className="select-none">{expandedProjectIds.has(p.id) ? "▾" : "▸"}</span>}
//         isExpanded={(p) => expandedProjectIds.has(p.id)}
//         onToggleExpand={handleToggleExpand}
//         renderExpandedRow={renderExpandedRow}
//         pageSize={10}
//       />

//       {/* ---- 이하 업로드 모달은 너가 준 원본 그대로 (생략 없이 유지) ---- */}
//       {isUploadModalOpen && modalProject && (
//         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
//           <div className="w-full max-w-3xl rounded-2xl bg-white p-6">
//             <div>
//               <h2 className="text-lg font-semibold">파일 업로드</h2>
//               <div className="mt-1 text-sm text-gray-600">
//                 {modalProject.year} / {modalProject.subject} / {modalProject.name}
//               </div>
//               <div className="mt-1 text-xs text-gray-500">
//                 문제지/해설지/정오표는 PDF/HWP 각각 1개만 업로드 가능(단독 업로드 가능). 기타는 제한 없음.
//               </div>
//             </div>

//             <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
//               {fileTypeOptions.map((t) => {
//                 if (t === "기타") {
//                   return (
//                     <div key={t} className="rounded-2xl border p-4">
//                       <div className="mb-2 flex items-center justify-between">
//                         <div className="text-sm font-semibold text-gray-900">기타</div>
//                         <div className="text-xs text-gray-500">{queuedMiscFiles.length}개</div>
//                       </div>

//                       <UploadDropzone
//                         compact
//                         accept=""
//                         multiple
//                         disabled={batchUploading}
//                         showLastAdded={false}
//                         showHintText={false}
//                         onReject={(m) => reject(m)}
//                         onFiles={(files) => addMiscFiles(files)}
//                       />

//                       {queuedMiscFiles.length > 0 && (
//                         <div className="mt-3 space-y-1">
//                           {queuedMiscFiles.map((f, idx) => (
//                             <div
//                               key={`${f.name}-${f.size}-${idx}`}
//                               className="flex items-center justify-between rounded-md border px-2 py-1"
//                             >
//                               <div className="min-w-0">
//                                 <div className="truncate text-xs text-gray-800">{f.name}</div>
//                                 <div className="text-[11px] text-gray-500">
//                                   {getFileExt(f.name)} • {f.size.toLocaleString()} bytes
//                                 </div>
//                               </div>
//                               <button
//                                 type="button"
//                                 className="ml-2 p-1 text-gray-500 hover:text-red-600 disabled:opacity-50"
//                                 onClick={() => removeMiscFile(idx)}
//                                 disabled={batchUploading}
//                                 title="Remove"
//                               >
//                                 <Trash2 className="h-3.5 w-3.5" />
//                               </button>
//                             </div>
//                           ))}
//                         </div>
//                       )}
//                     </div>
//                   );
//                 }

//                 const slots = queuedSlotsByType[t];

//                 return (
//                   <div key={t} className="rounded-2xl border p-4">
//                     <div className="mb-2 flex items-center justify-between">
//                       <div className="text-sm font-semibold text-gray-900">{t}</div>
//                       <div className="text-xs text-gray-500">PDF / HWP</div>
//                     </div>

//                     <div className="grid grid-cols-1 gap-3">
//                       {/* PDF slot */}
//                       <div className="rounded-xl border p-3">
//                         <div className="mb-2 flex items-center justify-between">
//                           <div className="text-xs font-semibold text-gray-700">PDF</div>
//                           {slots?.pdf.existing ? (
//                             <button
//                               type="button"
//                               className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
//                               onClick={() => void deleteExistingSlotFile(t, "pdf")}
//                               disabled={batchUploading}
//                             >
//                               삭제
//                             </button>
//                           ) : slots?.pdf.queued ? (
//                             <button
//                               type="button"
//                               className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
//                               onClick={() => removeQueuedSlotFile(t, "pdf")}
//                               disabled={batchUploading}
//                             >
//                               제거
//                             </button>
//                           ) : null}
//                         </div>

//                         {slots?.pdf.existing ? (
//                           <div className="rounded-md border px-2 py-1">
//                             <div className="truncate text-xs text-gray-800">{slots.pdf.existing.original_name}</div>
//                             <div className="text-[11px] text-gray-500">이미 업로드됨</div>
//                           </div>
//                         ) : slots?.pdf.queued ? (
//                           <div className="rounded-md border px-2 py-1">
//                             <div className="truncate text-xs text-gray-800">{slots.pdf.queued.name}</div>
//                             <div className="text-[11px] text-gray-500">업로드 대기</div>
//                           </div>
//                         ) : (
//                           <UploadDropzone
//                             compact
//                             accept=".pdf"
//                             multiple={false}
//                             disabled={batchUploading}
//                             showLastAdded={false}
//                             showHintText={false}
//                             onReject={(m) => reject(m)}
//                             onFiles={(files) => setQueuedSlotFile(t, "pdf", files[0])}
//                           />
//                         )}
//                       </div>

//                       {/* HWP slot */}
//                       <div className="rounded-xl border p-3">
//                         <div className="mb-2 flex items-center justify-between">
//                           <div className="text-xs font-semibold text-gray-700">HWP</div>
//                           {slots?.hwp.existing ? (
//                             <button
//                               type="button"
//                               className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
//                               onClick={() => void deleteExistingSlotFile(t, "hwp")}
//                               disabled={batchUploading}
//                             >
//                               삭제
//                             </button>
//                           ) : slots?.hwp.queued ? (
//                             <button
//                               type="button"
//                               className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
//                               onClick={() => removeQueuedSlotFile(t, "hwp")}
//                               disabled={batchUploading}
//                             >
//                               제거
//                             </button>
//                           ) : null}
//                         </div>

//                         {slots?.hwp.existing ? (
//                           <div className="rounded-md border px-2 py-1">
//                             <div className="truncate text-xs text-gray-800">{slots.hwp.existing.original_name}</div>
//                             <div className="text-[11px] text-gray-500">이미 업로드됨</div>
//                           </div>
//                         ) : slots?.hwp.queued ? (
//                           <div className="rounded-md border px-2 py-1">
//                             <div className="truncate text-xs text-gray-800">{slots.hwp.queued.name}</div>
//                             <div className="text-[11px] text-gray-500">업로드 대기</div>
//                           </div>
//                         ) : (
//                           <UploadDropzone
//                             compact
//                             accept=".hwp"
//                             multiple={false}
//                             disabled={batchUploading}
//                             showLastAdded={false}
//                             showHintText={false}
//                             onReject={(m) => reject(m)}
//                             onFiles={(files) => setQueuedSlotFile(t, "hwp", files[0])}
//                           />
//                         )}
//                       </div>
//                     </div>
//                   </div>
//                 );
//               })}
//             </div>

//             {uploadError && <div className="mt-3 whitespace-pre-line text-red-500 text-xs">{uploadError}</div>}
//             {uploadSuccess && <div className="text-green-600 text-xs mt-3">{uploadSuccess}</div>}

//             <div className="mt-5 flex items-center justify-end gap-2">
//               <button
//                 type="button"
//                 className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
//                 onClick={closeUploadModal}
//                 disabled={batchUploading}
//               >
//                 닫기
//               </button>
//               <button
//                 type="button"
//                 className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
//                 onClick={handleBatchUpload}
//                 disabled={batchUploading || totalQueuedCount === 0}
//               >
//                 {batchUploading ? "업로드 중..." : `업로드 (${totalQueuedCount})`}
//               </button>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }

// /* ---------- icon buttons ---------- */
// export function UploadButton({ onClick }: { onClick: () => void }) {
//   return (
//     <button onClick={onClick} className="p-1.5 text-gray-600 hover:text-indigo-600" title="Upload">
//       <Upload className="h-4 w-4" />
//     </button>
//   );
// }
