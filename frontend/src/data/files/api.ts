// FILE: frontend/src/data/files/api.ts

import axios from "axios";
import { getAuthedUser } from "@/auth";

const API_BASE_URL_RAW = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
const API_BASE_URL = API_BASE_URL_RAW.trim().replace(/\/+$/, "");

const api = axios.create({
  // Prefer explicit backend URL in production; fallback to same-origin /api proxy.
  baseURL: API_BASE_URL || "/api",
  withCredentials: true,
});

export function resolveApiUrl(pathOrUrl: string): string {
  const raw = (pathOrUrl || "").trim();
  if (!raw) return API_BASE_URL || "/api";
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  if (API_BASE_URL) return `${API_BASE_URL}${path}`;
  return `/api${path}`;
}

/**
 * Attach X-User-Id automatically (best-effort).
 * Backend should use this header to enforce ADMIN/LEAD permissions.
 */
api.interceptors.request.use((config) => {
  try {
    const me = getAuthedUser();
    const uid = me?.id;
    if (typeof uid === "number" && Number.isFinite(uid)) {
      config.headers = config.headers ?? {};
      (config.headers as any)["X-User-Id"] = String(uid);
    }
  } catch {
    // ignore
  }
  return config;
});

export default api;

///////////////
// INTERFACE //
///////////////
// Must match backend Project schema
export interface Project {
  id: number;
  name: string;
  subject: string;
  year: string | null;

  // NEW: category
  category: string;

  // Legacy (kept for backward compatibility)
  deadline: string | null;

  // NEW multi deadlines
  deadline_1: string | null;
  deadline_2: string | null;
  deadline_final: string | null;

  // ✅ NEW: ownership department (for LEAD restriction)
  owner_department?: string | null;

  // 개별 문항 목표 개수
  target_individual_items_count?: number;
}

export interface CreateProjectRequest {
  name: string;
  subject: string;
  year: string | null;

  // NEW: category (default handled by backend too, but we send it when UI provides)
  category?: string;

  // Legacy (optional)
  deadline?: string | null;

  // NEW multi deadlines
  deadline_1?: string | null;
  deadline_2?: string | null;
  deadline_final?: string | null;

  // ✅ NEW: ownership department (for LEAD restriction)
  owner_department?: string | null;

  // 개별 문항 목표 개수
  target_individual_items_count?: number;
}

export interface UpdateProjectRequest {
  name?: string;
  subject?: string;
  year?: string | null;
  status?: string;
  description?: string | null;

  category?: string;

  deadline?: string | null;
  deadline_1?: string | null;
  deadline_2?: string | null;
  deadline_final?: string | null;

  // optional update (if you later allow editing ownership)
  owner_department?: string | null;

  // 개별 문항 목표 개수
  target_individual_items_count?: number;
}

export interface FileAsset {
  id: number;
  project_id: number;
  file_key: string;
  original_name: string;
  mime_type?: string | null;
  size?: number | null;
  created_at: string;
  file_type?: string | null;
  uploaded_by_user_id?: number | null; // 누가 업로드했는지 기록
}

//////////////////////////

export async function deleteProject(id: number): Promise<void> {
  await api.delete(`/projects/${id}`);
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await api.get<Project[]>("/projects/");
  return res.data;
}

export async function createProject(data: CreateProjectRequest): Promise<Project> {
  const res = await api.post<Project>("/projects/", data);
  return res.data;
}

export async function updateProject(id: number, data: UpdateProjectRequest): Promise<Project> {
  const res = await api.put<Project>(`/projects/${id}`, data);
  return res.data;
}

export async function getProjectFiles(projectId: number): Promise<FileAsset[]> {
  const res = await api.get<FileAsset[]>(`/projects/${projectId}/files`);
  return res.data;
}

export async function deleteProjectFile(projectId: number, fileId: number): Promise<void> {
  await api.delete(`/projects/${projectId}/files/${fileId}`);
}

export async function uploadProjectFile(projectId: number, file: File, fileType: string): Promise<FileAsset> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("file_type", fileType);
  const res = await api.post<FileAsset>(`/projects/${projectId}/files`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

// Review 관련 인터페이스
export interface ReviewComment {
  id: number;
  review_id?: number;
  review_session_id?: number;
  author_id: number | null;
  author_name: string | null;
  comment_type: "text" | "handwriting" | "attachment";
  text_content: string | null;
  handwriting_image_url: string | null;
  page_number: number | null;
  x_position: number | null;
  y_position: number | null;
  created_at: string;
}

export interface Review {
  id: number;
  file_asset_id: number;
  project_id: number | null;
  file_name: string | null;
  project_name: string | null;
  project_year: string | null;
  status: string;
  reviewer_id: number | null;
  reviewer_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  comments: ReviewComment[];
}

export interface ReviewSessionOut {
  id: number;
  file_asset_id: number;
  project_id: number | null;
  file_name: string | null;
  project_name: string | null;
  project_year: string | null;
  status: string;
  reviewer_id: number | null;
  reviewer_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  comments: ReviewComment[];
}

export interface FileReviewSessionsOut {
  file_asset_id: number;
  file_name: string | null;
  project_id: number | null;
  project_name: string | null;
  project_year: string | null;
  request_revision_count: number;
  approved_count: number;
  sessions: ReviewSessionOut[];
}

export interface ReviewCommentCreate {
  comment_type: "text" | "handwriting" | "attachment";
  text_content?: string | null;
  handwriting_image_url?: string | null;
  page_number?: number | null;
  x_position?: number | null;
  y_position?: number | null;
}

export interface ReviewCommentUpdate {
  text_content: string;
}

export interface ReviewStatusUpdate {
  status: "in_progress" | "request_revision" | "approved";
}

// --- User / Activity (MyPage / HomePage) ---
export type UserRole = "ADMIN" | "LEAD" | "MEMBER" | "PENDING";

export interface UserInfo {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  department: string;
  departments: string[];
  phone_number: string | null;
  phone_verified: boolean;
  profile_image_url: string | null;
}

export interface ContributionStats {
  year: string;
  individual_items_count: number;
  content_files_count: number;
  total_files_count: number;
}

export interface ActivityItem {
  id: number;
  type: "file_upload" | "file_delete" | "review" | string;
  timestamp: string;
  user_name: string | null;
  project_name: string;
  project_year: string | null;
  file_name: string | null;
  file_type: string | null;
  description: string;
}

// Review 관련 API
export async function listContentFilesForReview(): Promise<Review[]> {
  const res = await api.get<Review[]>("/reviews/content-files");
  return res.data;
}

export async function getFileReview(fileId: number): Promise<Review> {
  const res = await api.get<Review>(`/reviews/files/${fileId}`);
  return res.data;
}

export async function startReview(fileId: number): Promise<Review> {
  const res = await api.post<Review>(`/reviews/files/${fileId}/start`);
  return res.data;
}

export async function addReviewComment(fileId: number, data: ReviewCommentCreate): Promise<ReviewComment> {
  const res = await api.post<ReviewComment>(`/reviews/files/${fileId}/comments`, data);
  return res.data;
}

export async function updateReviewComment(fileId: number, commentId: number, data: ReviewCommentUpdate): Promise<ReviewComment> {
  const res = await api.patch<ReviewComment>(`/reviews/files/${fileId}/comments/${commentId}`, data);
  return res.data;
}

export async function deleteReviewComment(fileId: number, commentId: number): Promise<void> {
  await api.delete(`/reviews/files/${fileId}/comments/${commentId}`);
}

export async function getCurrentUserInfo(): Promise<UserInfo> {
  const res = await api.get<UserInfo>(`/auth/me`);
  return res.data;
}

export async function updateUserInfo(payload: { name?: string; phone_number?: string }): Promise<UserInfo> {
  const res = await api.patch<UserInfo>(`/auth/me`, payload);
  return res.data;
}

export async function getUserContributions(year?: string): Promise<ContributionStats[]> {
  const res = await api.get<ContributionStats[]>(`/auth/me/contributions`, { params: year ? { year } : undefined });
  return res.data;
}

export async function uploadProfileImage(file: File): Promise<{ profile_image_url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post<{ profile_image_url: string }>(`/auth/me/profile-image`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function deleteProfileImage(): Promise<void> {
  await api.delete(`/auth/me/profile-image`);
}

export async function getRecentActivities(limit = 10): Promise<ActivityItem[]> {
  const res = await api.get<ActivityItem[]>(`/auth/activities`, { params: { limit } });
  return res.data;
}

export async function uploadHandwritingImage(
  fileId: number,
  file: File,
  page_number?: number,
  x_position?: number,
  y_position?: number
): Promise<{ handwriting_image_url: string; page_number?: number; x_position?: number; y_position?: number }> {
  const formData = new FormData();
  formData.append("file", file);
  if (page_number !== undefined) formData.append("page_number", String(page_number));
  if (x_position !== undefined) formData.append("x_position", String(x_position));
  if (y_position !== undefined) formData.append("y_position", String(y_position));

  const res = await api.post<{ handwriting_image_url: string; page_number?: number; x_position?: number; y_position?: number }>(
    `/reviews/files/${fileId}/handwriting`,
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
    }
  );
  return res.data;
}

export async function stopReview(fileId: number): Promise<Review> {
  const res = await api.post<Review>(`/reviews/files/${fileId}/stop`);
  return res.data;
}

export async function getFileInlineUrl(
  fileId: number,
  options?: { variant?: "baked" | "original"; reviewerUserId?: number }
): Promise<{ url: string; expires_minutes: number }> {
  const params = new URLSearchParams();
  if (options?.variant) params.set("variant", options.variant);
  if (options?.reviewerUserId != null) params.set("reviewer_user_id", String(options.reviewerUserId));
  const qs = params.toString();
  const res = await api.get<{ url: string; expires_minutes: number }>(
    `/reviews/files/${fileId}/inline-url${qs ? `?${qs}` : ""}`
  );
  return res.data;
}

export async function getFileReviewSessions(fileId: number): Promise<FileReviewSessionsOut> {
  const res = await api.get<FileReviewSessionsOut>(`/reviews/files/${fileId}/sessions`);
  return res.data;
}

export async function getFileReviewSummariesBulk(
  fileIds: number[]
): Promise<{ summaries: FileReviewSessionsOut[] }> {
  const res = await api.post<{ summaries: FileReviewSessionsOut[] }>(`/reviews/files/summaries-bulk`, {
    file_ids: fileIds,
  });
  return res.data;
}

export async function getFileViewUrl(fileId: number): Promise<{ url: string; expires_minutes: number }> {
  const res = await api.get<{ url: string; expires_minutes: number }>(`/reviews/files/${fileId}/view-url`);
  return { url: resolveApiUrl(res.data.url), expires_minutes: res.data.expires_minutes };
}

export async function getProjectIndividualItemsCount(projectId: number): Promise<{ project_id: number; individual_items_count: number }> {
  const res = await api.get<{ project_id: number; individual_items_count: number }>(`/projects/${projectId}/individual-items/count`);
  return res.data;
}

export async function getFileDownloadUrl(
  projectId: number,
  fileId: number
): Promise<{ id: number; url: string; expires_minutes: number; filename: string }> {
  const res = await api.get<{ id: number; url: string; expires_minutes: number; filename: string }>(
    `/projects/${projectId}/files/${fileId}/download`
  );
  return res.data;
}

function parseFilenameFromContentDisposition(cd: string | undefined | null): string | null {
  if (!cd) return null;
  // Prefer RFC 5987 filename*=UTF-8''...
  const mStar = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (mStar && mStar[1]) {
    try {
      return decodeURIComponent(mStar[1].trim().replace(/^"+|"+$/g, ""));
    } catch {
      return mStar[1].trim().replace(/^"+|"+$/g, "");
    }
  }
  const m = cd.match(/filename\s*=\s*("?)([^";]+)\1/i);
  if (m && m[2]) return m[2].trim();
  return null;
}

export async function downloadReviewPdf(
  fileId: number
): Promise<{ blob: Blob; filename: string; contentType: string }> {
  // Use view-url to ensure we download the same variant the viewer opens (baked if exists).
  const viewInfo = await api.get<{ url: string; expires_minutes: number }>(`/reviews/files/${fileId}/view-url`);
  const res = await api.get(viewInfo.data.url, { responseType: "blob" });
  const cd = (res.headers as any)?.["content-disposition"] as string | undefined;
  const ct = ((res.headers as any)?.["content-type"] as string | undefined) || "application/pdf";
  const filename = parseFilenameFromContentDisposition(cd) || `file_${fileId}.pdf`;
  return { blob: res.data as Blob, filename, contentType: ct };
}

export async function updateReviewStatus(fileId: number, status: ReviewStatusUpdate): Promise<Review> {
  const res = await api.patch<Review>(`/reviews/files/${fileId}/status`, status);
  return res.data;
}

// PDF 주석 관련 타입 및 API
export interface PDFAnnotation {
  id: string;
  page: number;
  x: number;
  y: number;
  text: string;
  author_id: number | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PDFAnnotationsData {
  annotations: PDFAnnotation[];
}

export interface PDFAnnotationCreate {
  page: number;
  x: number;
  y: number;
  text: string;
}

export async function getPDFAnnotations(fileId: number): Promise<PDFAnnotationsData> {
  const res = await api.get<PDFAnnotationsData>(`/reviews/files/${fileId}/annotations`);
  return res.data;
}

export async function savePDFAnnotations(fileId: number, data: PDFAnnotationsData): Promise<PDFAnnotationsData> {
  // Backend defaults to a minimal response for performance; request the full payload for this helper.
  const res = await api.post<PDFAnnotationsData>(`/reviews/files/${fileId}/annotations?return_full=1`, data);
  return res.data;
}
