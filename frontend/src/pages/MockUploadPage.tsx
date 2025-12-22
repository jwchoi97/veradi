import React, { useMemo, useState, useEffect } from "react";
import { Upload, Download, Trash2 } from "lucide-react";
import { getFileDownloadUrl } from "../data/files/api";
import {
  fetchProjects,
  getProjectFiles,
  uploadProjectFile,
  Project,
  FileAsset,
  deleteProjectFile,
} from "../data/files/api";

/* ---------- helpers ---------- */
function getFileExt(filename?: string | null) {
  if (!filename) return "";
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return "";
  return filename.slice(idx + 1).toUpperCase();
}

/* ---------- main page ---------- */
export default function MockUploadPage() {
  const years = useMemo(() => ["전체", "2024", "2025", "2026"], []);
  const subjects = useMemo(() => ["전체", "물리", "화학", "지구과학"], []);
  const viewOptions = useMemo(() => ["진행중인 프로젝트만", "모두 보기"], []);
  const fileTypeOptions = useMemo(() => ["문제지", "해설지", "정오표", "기타"], []);

  const [year, setYear] = useState("전체");
  const [subject, setSubject] = useState("전체");
  const [viewOption, setViewOption] = useState(viewOptions[0]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Allow multiple expanded projects
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(() => new Set());

  // Files per project
  const [projectFilesMap, setProjectFilesMap] = useState<Record<number, FileAsset[]>>({});
  const [filesLoadingMap, setFilesLoadingMap] = useState<Record<number, boolean>>({});

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [modalProject, setModalProject] = useState<Project | null>(null);
  const [modalFile, setModalFile] = useState<File | null>(null);
  const [modalFileType, setModalFileType] = useState<string>(fileTypeOptions[0]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  /* ---------- data load ---------- */
  const loadProjects = async () => {
    try {
      setListLoading(true);
      setError(null);
      const data = await fetchProjects();
      setProjects(data);
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
    } catch {
      setProjectFilesMap((prev) => ({ ...prev, [projectId]: [] }));
    } finally {
      setFilesLoadingMap((prev) => ({ ...prev, [projectId]: false }));
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (year !== "전체" && p.year !== year) return false;
      if (subject !== "전체" && p.subject !== subject) return false;
      return true;
    });
  }, [projects, year, subject]);

  const handleToggleExpand = (p: Project) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);

      if (next.has(p.id)) {
        next.delete(p.id);
        return next;
      }

      next.add(p.id);

      // Load files when opening (or refresh if not loaded yet)
      const alreadyLoaded = Object.prototype.hasOwnProperty.call(projectFilesMap, p.id);
      if (!alreadyLoaded) {
        void loadProjectFiles(p.id);
      }

      return next;
    });
  };

  const openUploadModal = (p: Project) => {
    setModalProject(p);
    setModalFile(null);
    setModalFileType(fileTypeOptions[0]);
    setUploadError(null);
    setUploadSuccess(null);
    setIsUploadModalOpen(true);
  };

  const closeUploadModal = () => {
    setIsUploadModalOpen(false);
    setModalProject(null);
    setModalFile(null);
    setUploadError(null);
    setUploadSuccess(null);
  };

  const handleModalFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    setModalFile(e.target.files?.[0] ?? null);
    setUploadError(null);
    setUploadSuccess(null);
  };

  const handleUpload = async () => {
    if (!modalProject || !modalFile) {
      setUploadError("파일을 선택하세요.");
      return;
    }

    try {
      setUploadLoading(true);
      await uploadProjectFile(modalProject.id, modalFile, modalFileType);
      setUploadSuccess("업로드 성공!");
      setModalFile(null);

      if (expandedProjectIds.has(modalProject.id)) {
        await loadProjectFiles(modalProject.id);
      }
    } catch {
      setUploadError("업로드 실패");
    } finally {
      setUploadLoading(false);
    }
  };

  const handleDeleteFile = async (file: FileAsset) => {
    const projectId = file.project_id;
    if (!window.confirm("정말로 이 파일을 삭제하시겠습니까?")) return;

    try {
      await deleteProjectFile(projectId, file.id);
      await loadProjectFiles(projectId);
    } catch (e) {
      console.error(e);
      alert("파일 삭제에 실패했습니다.");
    }
  };

  /* ---------- UI ---------- */
  return (
    <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
      {/* Filter section */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <LabeledSelect label="학년도 선택" value={year} onChange={setYear} options={years} />
          <LabeledSelect label="과목 선택" value={subject} onChange={setSubject} options={subjects} />
          <LabeledSelect label="보기 옵션" value={viewOption} onChange={setViewOption} options={viewOptions} />
        </div>
      </section>

      {/* Project list */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">프로젝트 목록</h2>

        {listLoading && <div className="text-gray-500 text-sm mb-2">프로젝트 목록을 불러오는 중입니다...</div>}
        {error && <div className="text-red-500 text-sm mb-2">{error}</div>}

        {filteredProjects.length === 0 && !listLoading ? (
          <div className="text-gray-500 text-sm text-center py-10">프로젝트가 없습니다.</div>
        ) : (
          <table className="w-full text-sm border-t">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-8" />
                <th className="text-left px-3 py-2">프로젝트명</th>
                <th className="text-left px-3 py-2">과목</th>
                <th className="text-left px-3 py-2">학년도</th>
                <th className="text-left px-3 py-2">마감일</th>
                <th className="text-left px-3 py-2">업로드</th>
              </tr>
            </thead>

            <tbody>
              {filteredProjects.map((p) => {
                const isOpen = expandedProjectIds.has(p.id);
                const filesLoading = !!filesLoadingMap[p.id];
                const projectFiles = projectFilesMap[p.id] ?? [];

                // Group files by file type; keep placeholders even if empty
                const grouped = new Map<string, FileAsset[]>();
                for (const t of fileTypeOptions) grouped.set(t, []);

                const unknown: FileAsset[] = [];
                for (const f of projectFiles) {
                  const t = (f.file_type ?? "").trim();
                  if (t && grouped.has(t)) grouped.get(t)!.push(f);
                  else unknown.push(f);
                }

                for (const t of fileTypeOptions) {
                  grouped.get(t)!.sort((a, b) => (a.id < b.id ? 1 : -1));
                }
                unknown.sort((a, b) => (a.id < b.id ? 1 : -1));

                // Show unknown group at bottom with blank type label, only if exists
                const orderedTypes = unknown.length > 0 ? [...fileTypeOptions, "__UNKNOWN__"] : [...fileTypeOptions];

                return (
                  <React.Fragment key={p.id}>
                    <tr className="border-t hover:bg-gray-50">
                      <td className="px-2">
                        <button onClick={() => handleToggleExpand(p)}>{isOpen ? "▾" : "▸"}</button>
                      </td>
                      <td className="px-3 py-2">{p.name}</td>
                      <td className="px-3 py-2">{p.subject}</td>
                      <td className="px-3 py-2">{p.year}</td>
                      <td className="px-3 py-2">{p.deadline?.split("T")[0]}</td>
                      <td className="px-3 py-2">
                        <UploadButton onClick={() => openUploadModal(p)} />
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="bg-gray-50">
                        <td colSpan={6} className="px-3 py-3">
                          {filesLoading ? (
                            <div className="text-gray-500 text-xs">불러오는 중...</div>
                          ) : (
                            <table className="min-w-full text-xs border">
                              <thead className="bg-gray-100">
                                <tr>
                                  <th className="px-3 py-2 text-left w-28">파일 타입</th>
                                  <th className="px-3 py-2 text-left">파일명</th>
                                  <th className="px-3 py-2 text-left w-20">확장자</th>
                                  <th className="px-3 py-2 text-left w-28">업로드일</th>
                                  <th className="px-3 py-2 text-right w-24">작업</th>
                                </tr>
                              </thead>

                              <tbody>
                                {orderedTypes.flatMap((t) => {
                                  const isUnknown = t === "__UNKNOWN__";
                                  const filesForType = isUnknown ? unknown : grouped.get(t) ?? [];

                                  // Keep at least 1 row even if empty for known types
                                  const rows: Array<FileAsset | null> =
                                    !isUnknown && filesForType.length === 0 ? [null] : filesForType;

                                  return rows.map((f, idx) => {
                                    const isPlaceholder = f == null;
                                    const typeCell = idx === 0 ? (isUnknown ? "" : t) : "";

                                    return (
                                      <tr key={`${p.id}-${t}-${f?.id ?? "empty"}-${idx}`} className="border-t">
                                        <td className="px-3 py-2 font-medium text-gray-800">{typeCell}</td>

                                        <td className="px-3 py-2">
                                          {isPlaceholder ? <span className="text-gray-300"> </span> : f.original_name}
                                        </td>

                                        <td className="px-3 py-2 text-gray-700">
                                          {isPlaceholder ? "" : getFileExt(f.original_name)}
                                        </td>

                                        <td className="px-3 py-2">
                                          {isPlaceholder ? "" : f.created_at?.split("T")[0] ?? ""}
                                        </td>

                                        <td className="px-3 py-2 text-right">
                                          {isPlaceholder ? (
                                            <span className="text-gray-300"> </span>
                                          ) : (
                                            <div className="inline-flex gap-1">
                                              <DownloadButton projectId={f.project_id} fileId={f.id} />
                                              <DeleteButton onClick={() => handleDeleteFile(f)} />
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  });
                                })}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* upload modal */}
      {isUploadModalOpen && modalProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="text-lg font-semibold mb-4">파일 업로드</h2>

            <div className="mb-3 text-sm">
              {modalProject.year} / {modalProject.subject} / {modalProject.name}
            </div>

            <select
              className="w-full h-9 border rounded-md px-2 text-sm mb-3"
              value={modalFileType}
              onChange={(e) => setModalFileType(e.target.value)}
            >
              {fileTypeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <input type="file" onChange={handleModalFileChange} />

            {uploadError && <div className="text-red-500 text-xs mt-2">{uploadError}</div>}
            {uploadSuccess && <div className="text-green-600 text-xs mt-2">{uploadSuccess}</div>}

            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                className="px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={closeUploadModal}
              >
                취소
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                onClick={handleUpload}
                disabled={uploadLoading}
              >
                {uploadLoading ? "업로드 중..." : "업로드"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex flex-col w-48">
      <span className="text-sm text-gray-600 mb-1">{label}</span>
      <select
        className="h-9 border rounded-md px-2 text-sm focus:border-indigo-600"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
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

export function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="p-1.5 text-gray-500 hover:text-red-600" title="Delete">
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function DownloadButton({ projectId, fileId }: { projectId: number; fileId: number }) {
  const onDownload = async () => {
    try {
      const { url } = await getFileDownloadUrl(projectId, fileId);
      window.open(url, "_blank");
    } catch (e) {
      console.error(e);
      alert("다운로드에 실패했습니다.");
    }
  };

  return (
    <button onClick={onDownload} className="p-1.5 text-gray-600 hover:text-gray-900" title="Download">
      <Download className="h-4 w-4" />
    </button>
  );
}
