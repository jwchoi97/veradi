import React, { useMemo, useState, useEffect } from "react";
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

function uniqByNameSize(files: File[]) {
  const map = new Map<string, File>();
  for (const f of files) map.set(`${f.name}__${f.size}`, f);
  return Array.from(map.values());
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

  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(() => new Set());

  const [projectFilesMap, setProjectFilesMap] = useState<Record<number, FileAsset[]>>({});
  const [filesLoadingMap, setFilesLoadingMap] = useState<Record<number, boolean>>({});
  const [individualItemsCountMap, setIndividualItemsCountMap] = useState<Record<number, number>>({});

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [modalProject, setModalProject] = useState<Project | null>(null);

  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

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
      const individualItems = files.filter((f) => (f.file_type ?? "").trim() === "개별문항");
      for (const f of individualItems) {
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

      clearAllSelection();
    } catch (e) {
      console.error(e);
      alert("파일 삭제에 실패했습니다.");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  /* ---------- data load ---------- */
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

      // 각 프로젝트의 개별 문항 개수 로드
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

      // 개별 문항 개수 업데이트
      try {
        const countData = await getProjectIndividualItemsCount(projectId);
        setIndividualItemsCountMap((prev) => ({
          ...prev,
          [projectId]: countData.individual_items_count,
        }));
      } catch {
        // ignore
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

    await loadProjectFiles(p.id);

    setQueuedFiles([]);
    setIsUploadModalOpen(true);
  };

  const closeUploadModal = () => {
    if (uploading) return;
    setIsUploadModalOpen(false);
    setModalProject(null);
    setQueuedFiles([]);
    clearMsg();
  };

  const addQueuedFiles = (files: File[]) => {
    clearMsg();
    setQueuedFiles((prev) => uniqByNameSize([...prev, ...files]));
  };

  const removeQueuedFile = (idx: number) => {
    setQueuedFiles((prev) => prev.slice(0, idx).concat(prev.slice(idx + 1)));
  };

  const handleUpload = async () => {
    if (!modalProject) return;

    if (queuedFiles.length === 0) {
      reject("업로드할 파일을 추가하세요.");
      return;
    }

    clearMsg();
    setUploading(true);

    try {
      for (const file of queuedFiles) {
        await uploadProjectFile(modalProject.id, file, "개별문항");
      }

      setUploadSuccess(`${queuedFiles.length}개 파일 업로드 성공!`);

      const files = await loadProjectFiles(modalProject.id);
      setQueuedFiles([]);

      if (expandedProjectIds.has(modalProject.id)) {
        await loadProjectFiles(modalProject.id);
      }
    } catch {
      reject("업로드 실패");
    } finally {
      setUploading(false);
    }
  };

  /* ---------- file table (expanded) ---------- */
  const renderExpandedRow = (p: Project) => {
    const filesLoading = !!filesLoadingMap[p.id];
    const projectFiles = projectFilesMap[p.id] ?? [];
    const individualItems = projectFiles.filter((f) => (f.file_type ?? "").trim() === "개별문항");

    if (filesLoading) return <div className="text-gray-500 text-xs">불러오는 중...</div>;

    if (individualItems.length === 0) {
      return <div className="text-gray-400 text-xs py-2">개별 문항이 없습니다.</div>;
    }

    return (
      <table className="min-w-full text-xs border">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-3 py-2 text-left">파일명</th>
            <th className="px-3 py-2 text-left w-20">확장자</th>
            <th className="px-3 py-2 text-left w-28">업로드일</th>
            <th className="px-3 py-2 text-right w-36 whitespace-nowrap">선택</th>
          </tr>
        </thead>

        <tbody>
          {individualItems.map((f) => (
            <tr key={f.id} className="border-t">
              <td className="px-3 py-2">{f.original_name}</td>
              <td className="px-3 py-2 text-gray-700">{getFileExt(f.original_name)}</td>
              <td className="px-3 py-2">{f.created_at?.split("T")[0] ?? ""}</td>
              <td className="px-3 py-2 text-right">
                <div className="inline-flex items-center justify-end gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded-md border-gray-300"
                    checked={getSelectedSet(p.id).has(f.id)}
                    onChange={() => toggleSelected(p.id, f.id)}
                    title="선택"
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">개별 문항 업로드</h1>

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
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6">
            <div>
              <h2 className="text-lg font-semibold">개별 문항 업로드</h2>
              <div className="mt-1 text-sm text-gray-600">
                {modalProject.year} / {modalProject.subject} / {modalProject.name}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                현재 업로드된 개별 문항: {individualItemsCountMap[modalProject.id] ?? 0}/
                {(modalProject as any).target_individual_items_count ?? 20}개
              </div>
            </div>

            <div className="mt-5">
              <UploadDropzone
                accept=""
                multiple
                disabled={uploading}
                showLastAdded={false}
                showHintText={true}
                onReject={(m) => reject(m)}
                onFiles={addQueuedFiles}
              />

              {queuedFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-700">업로드 대기 중인 파일 ({queuedFiles.length}개)</div>
                  {queuedFiles.map((f, idx) => (
                    <div
                      key={`${f.name}-${f.size}-${idx}`}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-gray-800">{f.name}</div>
                        <div className="text-xs text-gray-500">
                          {getFileExt(f.name)} • {f.size.toLocaleString()} bytes
                        </div>
                      </div>
                      <button
                        type="button"
                        className="ml-2 p-1 text-gray-500 hover:text-red-600 disabled:opacity-50"
                        onClick={() => removeQueuedFile(idx)}
                        disabled={uploading}
                        title="제거"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {uploadError && <div className="mt-3 whitespace-pre-line text-red-500 text-xs">{uploadError}</div>}
            {uploadSuccess && <div className="text-green-600 text-xs mt-3">{uploadSuccess}</div>}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                onClick={closeUploadModal}
                disabled={uploading}
              >
                닫기
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                onClick={handleUpload}
                disabled={uploading || queuedFiles.length === 0}
              >
                {uploading ? "업로드 중..." : `업로드 (${queuedFiles.length})`}
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
