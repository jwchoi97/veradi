import React, { useState, useEffect, useRef } from "react";
import { CheckCircle, XCircle, AlertCircle, PenTool, MessageSquare, FileText, Loader2, Square } from "lucide-react";
import {
  listContentFilesForReview,
  getFileReview,
  startReview,
  stopReview,
  addReviewComment,
  uploadHandwritingImage,
  updateReviewStatus,
  getFileViewUrl,
  type Review,
  type ReviewComment,
  type ReviewCommentCreate,
  fetchProjects,
  type Project,
  getProjectFiles,
  type FileAsset,
} from "@/data/files/api";
import { getAuthedUser } from "@/auth";

// 손글씨 입력 컴포넌트
function HandwritingCanvas({
  onSave,
  onCancel,
}: {
  onSave: (imageDataUrl: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const startDrawing = (e: MouseEvent | TouchEvent) => {
      setIsDrawing(true);
      const rect = canvas.getBoundingClientRect();
      const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
      const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
      ctx.beginPath();
      ctx.moveTo(x, y);
    };

    const draw = (e: MouseEvent | TouchEvent) => {
      if (!isDrawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
      const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const stopDrawing = () => {
      setIsDrawing(false);
    };

    canvas.addEventListener("mousedown", startDrawing);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", stopDrawing);
    canvas.addEventListener("mouseleave", stopDrawing);
    canvas.addEventListener("touchstart", startDrawing);
    canvas.addEventListener("touchmove", draw);
    canvas.addEventListener("touchend", stopDrawing);

    return () => {
      canvas.removeEventListener("mousedown", startDrawing);
      canvas.removeEventListener("mousemove", draw);
      canvas.removeEventListener("mouseup", stopDrawing);
      canvas.removeEventListener("mouseleave", stopDrawing);
      canvas.removeEventListener("touchstart", startDrawing);
      canvas.removeEventListener("touchmove", draw);
      canvas.removeEventListener("touchend", stopDrawing);
    };
  }, [isDrawing]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const imageDataUrl = canvas.toDataURL("image/png");
    onSave(imageDataUrl);
  };

  return (
    <div className="border rounded-lg p-4 bg-white">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">손글씨 입력</span>
        <button
          onClick={handleClear}
          className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
        >
          지우기
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={600}
        height={400}
        className="border rounded cursor-crosshair w-full"
        style={{ touchAction: "none" }}
      />
      <div className="mt-2 flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
        >
          취소
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded"
        >
          저장
        </button>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [selectedFileAsset, setSelectedFileAsset] = useState<FileAsset | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [showHandwriting, setShowHandwriting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // 컴포넌트 언마운트 시 blob URL 정리
  useEffect(() => {
    return () => {
      if (fileUrl && fileUrl.startsWith("blob:")) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  useEffect(() => {
    void loadReviews();
    void loadProjects();
  }, [statusFilter]);

  const loadProjects = async () => {
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch (e) {
      console.error("Failed to load projects", e);
    }
  };

  const loadReviews = async () => {
    try {
      setLoading(true);
      const data = await listContentFilesForReview(undefined, statusFilter === "all" ? undefined : statusFilter);
      setReviews(data);
    } catch (e) {
      console.error("Failed to load reviews", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectReview = async (review: Review) => {
    try {
      setLoading(true);
      // 이전 blob URL 정리
      if (fileUrl && fileUrl.startsWith("blob:")) {
        URL.revokeObjectURL(fileUrl);
      }
      setFileUrl(null);
      const fullReview = await getFileReview(review.file_asset_id);
      setSelectedReview(fullReview);

      // project_id 찾기
      let projectId = fullReview.project_id;
      if (!projectId) {
        // 프로젝트 찾기 (fallback)
        const allProjects = await fetchProjects();
        for (const project of allProjects) {
          const files = await getProjectFiles(project.id);
          const file = files.find((f) => f.id === review.file_asset_id);
          if (file) {
            projectId = file.project_id;
            setSelectedFileAsset(file);
            break;
          }
        }
      }

      try {
        // 뷰어용 URL 가져오기 (inline disposition)
        const viewInfo = await getFileViewUrl(fullReview.file_asset_id);
        setFileUrl(viewInfo.url);
      } catch (e) {
        console.error("Failed to load file view URL", e);
        // 에러 발생 시에도 loading은 false로 설정
      }
    } catch (e) {
      console.error("Failed to load review details", e);
    } finally {
      setLoading(false);
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

  const handleSaveHandwriting = async (imageDataUrl: string) => {
    if (!selectedReview) return;
    try {
      // Data URL을 Blob으로 변환
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();
      const file = new File([blob], "handwriting.png", { type: "image/png" });

      const result = await uploadHandwritingImage(selectedReview.file_asset_id, file);
      
      // 코멘트로 저장
      const comment: ReviewCommentCreate = {
        comment_type: "handwriting",
        handwriting_image_url: result.handwriting_image_url,
      };
      await addReviewComment(selectedReview.file_asset_id, comment);
      setShowHandwriting(false);
      
      // 리뷰 새로고침
      const updated = await getFileReview(selectedReview.file_asset_id);
      setSelectedReview(updated);
    } catch (e) {
      console.error("Failed to save handwriting", e);
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

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">콘텐츠 검토</h1>

      <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-6">
        {/* 파일 목록 */}
        <div className="space-y-4">
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
          ) : reviews.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-8">검토할 파일이 없습니다.</div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {reviews.map((review) => (
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
        </div>

        {/* 파일 뷰어 및 코멘트 */}
        <div className="space-y-4">
          {selectedReview ? (
            <>
              {/* 파일 뷰어 */}
              <div className="border rounded-lg p-4 bg-white">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">파일 뷰어</h2>
                  <div className="flex gap-2">
                    {selectedReview.status === "pending" && (
                      <button
                        onClick={handleStartReview}
                        className="px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded"
                      >
                        검토 시작
                      </button>
                    )}
                    {selectedReview.status === "in_progress" && (
                      <button
                        onClick={handleStopReview}
                        className="px-3 py-1.5 text-sm bg-gray-600 text-white hover:bg-gray-700 rounded"
                      >
                        검토 중지
                      </button>
                    )}
                  </div>
                </div>
                {fileUrl ? (
                  <div className="relative w-full h-[600px] border rounded overflow-hidden">
                    <iframe
                      src={fileUrl}
                      className="w-full h-full"
                      title="PDF Viewer"
                      onError={() => {
                        console.error("Failed to load PDF");
                      }}
                    />
                    {selectedFileAsset && (
                      <div className="absolute top-2 right-2 bg-white/90 px-2 py-1 rounded text-xs text-gray-600">
                        {selectedFileAsset.original_name}
                      </div>
                    )}
                  </div>
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

              {/* 코멘트 입력 */}
              <div className="border rounded-lg p-4 bg-white">
                <h3 className="text-lg font-semibold mb-4">코멘트</h3>

                {!showHandwriting ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="텍스트 코멘트를 입력하세요..."
                        className="flex-1 px-3 py-2 border rounded-lg text-sm resize-none"
                        rows={3}
                      />
                      <button
                        onClick={handleAddTextComment}
                        disabled={!commentText.trim()}
                        className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </button>
                    </div>
                    <button
                      onClick={() => setShowHandwriting(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded"
                    >
                      <PenTool className="h-4 w-4" />
                      손글씨 입력
                    </button>
                  </div>
                ) : (
                  <HandwritingCanvas
                    onSave={handleSaveHandwriting}
                    onCancel={() => setShowHandwriting(false)}
                  />
                )}

                {/* 코멘트 목록 */}
                <div className="mt-6 space-y-3">
                  <h4 className="text-sm font-semibold">코멘트 목록</h4>
                  {selectedReview.comments.length === 0 ? (
                    <div className="text-sm text-gray-500">코멘트가 없습니다.</div>
                  ) : (
                    selectedReview.comments.map((comment) => (
                      <div key={comment.id} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-gray-700">
                            {comment.author_name || "알 수 없음"}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(comment.created_at).toLocaleString("ko-KR")}
                          </span>
                        </div>
                        {comment.comment_type === "text" ? (
                          <div className="text-sm text-gray-900">{comment.text_content}</div>
                        ) : (
                          comment.handwriting_image_url && (
                            <img
                              src={comment.handwriting_image_url}
                              alt="Handwriting"
                              className="max-w-full h-auto border rounded"
                            />
                          )
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 검토 상태 변경 */}
              {selectedReview.status === "in_progress" && (
                <div className="border rounded-lg p-4 bg-white">
                  <h3 className="text-lg font-semibold mb-4">검토 완료</h3>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleUpdateStatus("request_revision")}
                      className="flex-1 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded"
                    >
                      수정 요청
                    </button>
                    <button
                      onClick={() => handleUpdateStatus("approved")}
                      className="flex-1 px-4 py-2 bg-green-600 text-white hover:bg-green-700 rounded"
                    >
                      검토 완료
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="border rounded-lg p-8 bg-white text-center text-gray-500">
              파일을 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
