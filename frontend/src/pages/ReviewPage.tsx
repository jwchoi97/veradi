import React, { useState, useEffect, useMemo, useRef } from "react";
import { CheckCircle, XCircle, AlertCircle, FileText, Loader2, ChevronRight, ChevronLeft, FolderOpen } from "lucide-react";
import {
  listContentFilesForReview,
  getFileReview,
  updateReviewStatus,
  getFileViewUrl,
  type Review,
  fetchProjects,
  type Project,
  getProjectFiles,
  type FileAsset,
} from "@/data/files/api";
import PdfJsKonvaViewer, { PdfJsKonvaViewerLoadingShell } from "@/components/PdfJsKonvaViewer";

export default function ReviewPage() {
  const [deepLinkFileAssetId] = useState<number | null>(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const raw = sp.get("file_asset_id") ?? sp.get("file") ?? sp.get("fileId");
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [selectedFileAsset, setSelectedFileAsset] = useState<FileAsset | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  /** 프로젝트 선택: null=프로젝트 목록, -1=미분류, number=프로젝트 ID */
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);

  // 브라우저 네이티브 Fullscreen API (F11과 동일)
  useEffect(() => {
    if (!isFullscreen) return;
    const el = fullscreenContainerRef.current;
    if (!el?.requestFullscreen) return;
    el.requestFullscreen().catch((err) => {
      console.warn("Fullscreen request failed:", err);
      setIsFullscreen(false);
    });
  }, [isFullscreen]);

  useEffect(() => {
    if (isFullscreen) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, [isFullscreen]);

  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // 컴포넌트 언마운트 시 blob URL 정리
  useEffect(() => {
    return () => {
      if (fileUrl && fileUrl.startsWith("blob:")) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  // 전체화면 닫기 단축키 (ESC는 iframe에서 선택모드와 충돌하므로 사용하지 않음)
  useEffect(() => {
    const handleCloseKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || (t as any).isContentEditable)) return;
      if (!isFullscreen) return;
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleCloseKey);
    return () => window.removeEventListener("keydown", handleCloseKey);
  }, [isFullscreen]);

  // NOTE: iframe 기반 pdfjs-viewer 경로는 제거됨.

  const openReviewByFileAssetId = async (fileAssetId: number) => {
    setSelectedReview(null);
    setSelectedFileAsset(null);
    setFileUrl(null);

    setLoading(true);
    try {
      // 상세 정보 조회 (코멘트 포함)
      const fullReview = await getFileReview(fileAssetId);
      setSelectedReview(fullReview);
      setSelectedProjectId(fullReview.project_id ?? -1);

      // 프로젝트 파일 목록에서 원본 이름 찾기
      if (typeof fullReview.project_id === "number") {
        const projectFiles = await getProjectFiles(fullReview.project_id);
        const asset = projectFiles.find((f) => f.id === fullReview.file_asset_id);
        if (asset) setSelectedFileAsset(asset);
      }

      // PDF 뷰어용 URL 생성
      const viewInfo = await getFileViewUrl(fileAssetId);
      setFileUrl(viewInfo.url);
    } catch (e) {
      console.error("Failed to open review by file_asset_id", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReviews();
    void loadProjects();
    if (deepLinkFileAssetId != null) {
      void openReviewByFileAssetId(deepLinkFileAssetId);
    }
  }, []);

  const loadReviews = async () => {
    setLoading(true);
    try {
      const data = await listContentFilesForReview();
      setReviews(data);
    } catch (e) {
      console.error("Failed to load reviews", e);
    } finally {
      setLoading(false);
    }
  };

  const loadProjects = async () => {
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch (e) {
      console.error("Failed to load projects", e);
    }
  };

  const handleSelectReview = async (review: Review) => {
    setSelectedReview(review);
    setSelectedFileAsset(null);
    setFileUrl(null);

    try {
      // 상세 정보 조회 (코멘트 포함)
      const fullReview = await getFileReview(review.file_asset_id);
      setSelectedReview(fullReview);

      // 프로젝트 파일 목록에서 원본 이름 찾기
      if (typeof fullReview.project_id === "number") {
        const projectFiles = await getProjectFiles(fullReview.project_id);
        const asset = projectFiles.find((f) => f.id === fullReview.file_asset_id);
        if (asset) setSelectedFileAsset(asset);
      }

      // PDF 뷰어용 URL 생성
      if (fullReview.file_asset_id) {
        const viewInfo = await getFileViewUrl(fullReview.file_asset_id);
        setFileUrl(viewInfo.url);
      }
    } catch (e) {
      console.error("Failed to load review details", e);
    }
  };

  const handleUpdateStatus = async (status: "in_progress" | "request_revision" | "approved") => {
    if (!selectedReview) return;
    try {
      const updated = await updateReviewStatus(selectedReview.file_asset_id, { status });
      setSelectedReview(updated);
      void loadReviews();
    } catch (e) {
      console.error("Failed to update status", e);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "request_revision":
        return <XCircle className="h-4 w-4 text-red-600" />;
      case "in_progress":
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      default:
        return <FileText className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "approved":
        return "검토완료";
      case "request_revision":
        return "수정요청";
      case "in_progress":
        return "검토필요";
      default:
        return "대기중";
    }
  };

  // 필터링된 리뷰 목록
  const filteredReviews = useMemo(() => {
    return reviews.filter((r) => {
      if (statusFilter === "all") return true;
      return r.status === statusFilter;
    });
  }, [reviews, statusFilter]);

  // 프로젝트별로 그룹화 (project_id 기준)
  type ProjectGroup = { projectId: number | null; projectName: string; projectYear: string | null; reviews: Review[] };
  const projectGroups = useMemo<ProjectGroup[]>(() => {
    const byProject = new Map<number | null, Review[]>();
    for (const r of filteredReviews) {
      const pid = r.project_id ?? null;
      const arr = byProject.get(pid) ?? [];
      arr.push(r);
      byProject.set(pid, arr);
    }
    const groups = Array.from(byProject.entries()).map(([projectId, reviews]) => {
      const first = reviews[0];
      return {
        projectId,
        projectName: first?.project_name ?? "미분류",
        projectYear: first?.project_year ?? null,
        reviews,
      };
    });
    return groups.sort((a, b) => {
      if (a.projectName === "미분류") return 1;
      if (b.projectName === "미분류") return -1;
      return (a.projectName ?? "").localeCompare(b.projectName ?? "");
    });
  }, [filteredReviews]);

  // 선택된 프로젝트의 파일 목록 (-1=미분류)
  const filesInSelectedProject = useMemo(() => {
    if (selectedProjectId == null) return [];
    const g = projectGroups.find((g) =>
      selectedProjectId === -1 ? g.projectId === null : g.projectId === selectedProjectId
    );
    return g?.reviews ?? [];
  }, [projectGroups, selectedProjectId]);

  const selectedProjectInfo = useMemo(() => {
    if (selectedProjectId == null) return null;
    return projectGroups.find((g) =>
      selectedProjectId === -1 ? g.projectId === null : g.projectId === selectedProjectId
    );
  }, [projectGroups, selectedProjectId]);

  return (
    // TopBar(56px) 아래를 꽉 채우고, AppLayout의 main padding(20px)을 상쇄
    <div className="h-[calc(100vh-56px)] -m-5 p-4 pt-3 min-h-0">
      <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-6 h-full min-h-0">
        {/* 파일 목록 + 코멘트/상태(좌측으로 합치기) */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between pb-2">
            <h1 className="text-2xl font-bold">콘텐츠 검토</h1>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              <option value="all">전체</option>
              <option value="in_progress">검토필요</option>
              <option value="request_revision">수정요청</option>
              <option value="approved">검토완료</option>
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : filteredReviews.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-8">검토할 파일이 없습니다.</div>
          ) : selectedProjectId != null ? (
            /* 프로젝트 내 파일 목록 */
            <div className="flex flex-col flex-1 min-h-0">
              <button
                type="button"
                onClick={() => setSelectedProjectId(null)}
                className="mb-3 flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
              >
                <ChevronLeft className="h-4 w-4" />
                프로젝트 목록으로
              </button>
              <div className="text-sm font-medium text-gray-700 mb-2">
                {selectedProjectInfo?.projectName}
                {selectedProjectInfo?.projectYear && ` (${selectedProjectInfo.projectYear})`}
              </div>
              <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
                {filesInSelectedProject.map((review) => (
                  <div
                    key={review.id}
                    onClick={() => handleSelectReview(review)}
                    className={`p-3 rounded-lg border cursor-pointer transition ${
                      selectedReview?.id === review.id
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {getStatusIcon(review.status)}
                      <span className="text-xs font-semibold">{getStatusLabel(review.status)}</span>
                    </div>
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {review.file_name || `파일 ID: ${review.file_asset_id}`}
                    </div>
                    {review.reviewer_name && (
                      <div className="text-xs text-gray-500">검토자: {review.reviewer_name}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* 프로젝트 목록 (폴더 선택) */
            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
              {projectGroups.map((g) => (
                <button
                  key={g.projectId ?? "uncategorized"}
                  type="button"
                  onClick={() => setSelectedProjectId(g.projectId ?? -1)}
                  className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderOpen className="h-5 w-5 text-indigo-500 shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {g.projectName}
                        {g.projectYear && ` (${g.projectYear})`}
                      </div>
                      <div className="text-xs text-gray-500">
                        {g.reviews.length}개 파일
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 파일 뷰어 */}
        <div
          ref={fullscreenContainerRef}
          className={
              isFullscreen
                ? "fixed inset-0 z-[9999] bg-black overflow-hidden flex flex-col"
                : `border rounded-lg bg-white flex-1 min-h-0 p-0 overflow-hidden relative ${!selectedReview && !loading ? "flex flex-col items-center justify-center py-12 px-6 text-gray-500" : ""}`
            }
          >
            {selectedReview ? (
              fileUrl ? (
                <>
                  {/* PDF 스크롤 영역: 바깥(main)은 고정, 이 영역에서만 스크롤 */}
                  <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
                    <PdfJsKonvaViewer
                    fileUrl={fileUrl}
                    fileId={selectedReview.file_asset_id}
                    fileName={selectedFileAsset?.original_name ?? null}
                    reviewStatus={selectedReview.status}
                    fullscreen={isFullscreen}
                    onFullscreenChange={setIsFullscreen}
                    onSetInProgress={() => handleUpdateStatus("in_progress")}
                    onRequestRevision={() => handleUpdateStatus("request_revision")}
                    onApprove={() => handleUpdateStatus("approved")}
                  />
                </div>
              </>
              ) : (
                /* fileUrl 로딩 전: 툴바 + PDF 로딩 중 (백엔드 통신 없이 즉시 표시) */
                <div className="absolute inset-0 overflow-hidden">
                  <PdfJsKonvaViewerLoadingShell
                    reviewStatus={selectedReview.status}
                    fullscreen={isFullscreen}
                    onFullscreenChange={setIsFullscreen}
                    onSetInProgress={() => handleUpdateStatus("in_progress")}
                    onRequestRevision={() => handleUpdateStatus("request_revision")}
                    onApprove={() => handleUpdateStatus("approved")}
                  />
                </div>
              )
            ) : loading ? (
              <div className="flex items-center justify-center h-[600px] text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                파일을 불러오는 중...
              </div>
            ) : (
              <>
                <FileText className="h-12 w-12 mb-4 text-gray-400" />
                <p className="text-sm">파일을 선택하면 여기에 표시됩니다.</p>
              </>
            )}
        </div>
      </div>
    </div>
  );
}
