import React, { useState, useEffect, useRef } from "react";
import { CheckCircle, XCircle, AlertCircle, MessageSquare, FileText, Loader2, Maximize2, X } from "lucide-react";
import {
  listContentFilesForReview,
  getFileReview,
  startReview,
  stopReview,
  addReviewComment,
  updateReviewComment,
  deleteReviewComment,
  updateReviewStatus,
  getFileViewUrl,
  uploadAnnotatedPdf,
  downloadReviewPdf,
  type Review,
  type ReviewComment,
  type ReviewCommentCreate,
  fetchProjects,
  type Project,
  getProjectFiles,
  type FileAsset,
} from "@/data/files/api";
import { getAuthedUser } from "@/auth";
import PdfJsKonvaViewer from "@/components/PdfJsKonvaViewer";

export default function ReviewPage() {
  const me = getAuthedUser();
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
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState<string>("");
  const annotatedPdfInputRef = useRef<HTMLInputElement | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const handleStartReview = async () => {
    if (!selectedReview) return;
    try {
      const updated = await startReview(selectedReview.file_asset_id);
      setSelectedReview(updated);
      void loadReviews();
    } catch (e) {
      console.error("Failed to start review", e);
    }
  };

  const handleStopReview = async () => {
    if (!selectedReview) return;
    try {
      const updated = await stopReview(selectedReview.file_asset_id);
      setSelectedReview(updated);
      void loadReviews();
    } catch (e) {
      console.error("Failed to stop review", e);
    }
  };

  const handleAddTextComment = async () => {
    if (!selectedReview || !commentText.trim()) return;
    try {
      const comment: ReviewCommentCreate = {
        comment_type: "text",
        text_content: commentText,
      };
      await addReviewComment(selectedReview.file_asset_id, comment);
      setCommentText("");
      // 리뷰 새로고침
      const updated = await getFileReview(selectedReview.file_asset_id);
      setSelectedReview(updated);
    } catch (e) {
      console.error("Failed to add comment", e);
    }
  };

  const handleEditComment = (c: ReviewComment) => {
    if (!c || c.comment_type !== "text") return;
    setEditingCommentId(c.id);
    setEditingCommentText(c.text_content || "");
  };

  const handleSaveEditedComment = async () => {
    if (!selectedReview) return;
    if (!editingCommentId) return;
    const text = (editingCommentText || "").trim();
    if (!text) return;
    try {
      await updateReviewComment(selectedReview.file_asset_id, editingCommentId, { text_content: text });
      setEditingCommentId(null);
      setEditingCommentText("");
      const updated = await getFileReview(selectedReview.file_asset_id);
      setSelectedReview(updated);
    } catch (e) {
      console.error("Failed to update comment", e);
    }
  };

  const handleDeleteComment = async (c: ReviewComment) => {
    if (!selectedReview) return;
    if (!c) return;
    if (!confirm("이 코멘트를 삭제할까요?")) return;
    try {
      await deleteReviewComment(selectedReview.file_asset_id, c.id);
      if (editingCommentId === c.id) {
        setEditingCommentId(null);
        setEditingCommentText("");
      }
      const updated = await getFileReview(selectedReview.file_asset_id);
      setSelectedReview(updated);
    } catch (e) {
      console.error("Failed to delete comment", e);
    }
  };

  const handleUploadAnnotatedPdf = async (file: File) => {
    if (!selectedReview) return;
    try {
      await uploadAnnotatedPdf(selectedReview.file_asset_id, file);
      const updated = await getFileReview(selectedReview.file_asset_id);
      setSelectedReview(updated);
    } catch (e) {
      console.error("Failed to upload annotated pdf", e);
    }
  };

  const handleOpenInExternalApp = async () => {
    if (!selectedReview) return;
    try {
      const { blob, filename } = await downloadReviewPdf(selectedReview.file_asset_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "document.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      console.error("Failed to download pdf", e);
    }
  };

  const handleUpdateStatus = async (status: "request_revision" | "approved") => {
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
        return "검토중";
      default:
        return "대기중";
    }
  };

  // 필터링된 리뷰 목록
  const filteredReviews = reviews.filter((r) => {
    if (statusFilter === "all") return true;
    return r.status === statusFilter;
  });

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
              <option value="pending">대기중</option>
              <option value="in_progress">검토중</option>
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
          ) : (
            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
              {filteredReviews.map((review) => (
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
                  {review.project_name && (
                    <div className="text-xs text-gray-600">
                      {review.project_name}
                      {review.project_year && ` (${review.project_year})`}
                    </div>
                  )}
                  {review.reviewer_name && (
                    <div className="text-xs text-gray-500">검토자: {review.reviewer_name}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 선택된 파일의 코멘트/검토 완료 UI를 좌측에 합침 */}
          {selectedReview && (
            <div className="mt-3 border rounded-lg bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  {selectedFileAsset?.original_name || selectedReview.file_name || `파일 ID: ${selectedReview.file_asset_id}`}
                </div>
                <button
                  onClick={handleOpenInExternalApp}
                  className="shrink-0 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                  title="원본 PDF를 다운로드합니다. 다운로드 후 Acrobat/Preview 등 외부 앱으로 열 수 있어요."
                >
                  외부 앱으로 열기
                </button>
              </div>

              {/* 코멘트 입력 */}
              <div className="mt-3 flex gap-2">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="코멘트를 입력하세요..."
                  className="flex-1 px-3 py-2 border rounded-lg text-sm resize-none"
                  rows={3}
                />
                <button
                  onClick={handleAddTextComment}
                  disabled={!commentText.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="코멘트 추가"
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
              </div>

              {/* 외부 앱에서 주석한 PDF 업로드 */}
              <div className="mt-2 flex items-center gap-2">
                <input
                  ref={annotatedPdfInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUploadAnnotatedPdf(f);
                    e.currentTarget.value = "";
                  }}
                />
                <button
                  onClick={() => annotatedPdfInputRef.current?.click()}
                  className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                >
                  주석 PDF 업로드
                </button>
                <div className="text-xs text-gray-500 truncate">
                  외부 앱(Acrobat/Preview)에서 주석 후 저장한 PDF를 올리면 코멘트로 첨부됩니다.
                </div>
              </div>

              {/* 코멘트 목록 */}
              <div className="mt-3 max-h-[240px] overflow-y-auto pr-1 space-y-2">
                {selectedReview.comments.length === 0 ? (
                  <div className="text-sm text-gray-500">코멘트가 없습니다.</div>
                ) : (
                  selectedReview.comments.map((comment) => (
                    <div key={comment.id} className="border rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-gray-700">
                          {comment.author_name || "알 수 없음"}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(comment.created_at).toLocaleString("ko-KR")}
                        </span>
                      </div>
                      {comment.comment_type === "text" && (
                        <>
                          {editingCommentId === comment.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editingCommentText}
                                onChange={(e) => setEditingCommentText(e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
                                rows={3}
                              />
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => { setEditingCommentId(null); setEditingCommentText(""); }}
                                  className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                                >
                                  취소
                                </button>
                                <button
                                  onClick={handleSaveEditedComment}
                                  disabled={!editingCommentText.trim()}
                                  className="px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded disabled:opacity-50"
                                >
                                  저장
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm text-gray-900 whitespace-pre-wrap">{comment.text_content}</div>
                          )}

                          {/* 작성자만 수정/삭제 */}
                          {me?.id && comment.author_id === me.id && editingCommentId !== comment.id && (
                            <div className="mt-2 flex gap-2 justify-end">
                              <button
                                onClick={() => handleEditComment(comment)}
                                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                              >
                                수정
                              </button>
                              <button
                                onClick={() => handleDeleteComment(comment)}
                                className="px-3 py-1.5 text-xs bg-red-600 text-white hover:bg-red-700 rounded"
                              >
                                삭제
                              </button>
                            </div>
                          )}
                        </>
                      )}
                      {comment.comment_type === "attachment" && (
                        <div className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <a
                              href={comment.handwriting_image_url || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 hover:underline truncate"
                              title={comment.text_content || "첨부 PDF"}
                            >
                              {comment.text_content || "첨부 PDF"}
                            </a>
                            {me?.id && comment.author_id === me.id && (
                              <button
                                onClick={() => handleDeleteComment(comment)}
                                className="px-3 py-1.5 text-xs bg-red-600 text-white hover:bg-red-700 rounded"
                              >
                                삭제
                              </button>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">첨부(PDF)</div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* 검토 상태 변경 */}
              {selectedReview.status === "in_progress" && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleUpdateStatus("request_revision")}
                    className="flex-1 px-3 py-2 bg-red-600 text-white hover:bg-red-700 rounded"
                  >
                    수정 요청
                  </button>
                  <button
                    onClick={() => handleUpdateStatus("approved")}
                    className="flex-1 px-3 py-2 bg-green-600 text-white hover:bg-green-700 rounded"
                  >
                    검토 완료
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 파일 뷰어 */}
        <div className="flex flex-col gap-4 min-h-0">
          <div className={isFullscreen 
            ? "fixed inset-0 z-50 bg-black overflow-y-auto overflow-x-hidden" 
            : "border rounded-lg bg-white flex-1 min-h-0 p-0 overflow-y-auto overflow-x-hidden relative"
          }>
            {fileUrl && selectedReview ? (
              <PdfJsKonvaViewer
                fileUrl={fileUrl}
                fileId={selectedReview.file_asset_id}
                fileName={selectedFileAsset?.original_name ?? null}
                reviewStatus={selectedReview.status}
                fullscreen={isFullscreen}
                onFullscreenChange={setIsFullscreen}
                onStartReview={handleStartReview}
                onStopReview={handleStopReview}
              />
            ) : loading ? (
              <div className="flex items-center justify-center h-[600px] text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                파일을 불러오는 중...
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[600px] text-gray-500 border rounded">
                <FileText className="h-12 w-12 mb-4 text-gray-400" />
                <p className="text-sm">파일을 선택하면 여기에 표시됩니다.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
