// FILE: frontend/src/data/files/api.ts

import axios from "axios";
import { getAuthedUser } from "@/auth";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
});

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
  const res = await api.get<Project[]>("/projects");
  return res.data;
}

export async function createProject(data: CreateProjectRequest): Promise<Project> {
  const res = await api.post<Project>("/projects", data);
  return res.data;
}

export async function updateProject(projectId: number, data: UpdateProjectRequest): Promise<Project> {
  const res = await api.patch<Project>(`/projects/${projectId}`, data);
  return res.data;
}

///// File Asset API //////

export async function getProjectFiles(projectId: number): Promise<FileAsset[]> {
  const res = await api.get<FileAsset[]>(`/projects/${projectId}/files`);
  return res.data;
}

export async function uploadProjectFile(
  projectId: number,
  file: File,
  fileType: string
): Promise<{ id: number; file_key: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("file_type", fileType);

  const res = await api.post<{ id: number; file_key: string }>(`/projects/${projectId}/files`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return res.data;
}

export async function deleteProjectFile(projectId: number, fileId: number): Promise<void> {
  await api.delete(`/projects/${projectId}/files/${fileId}`);
}

export async function getFileDownloadUrl(projectId: number, fileId: number) {
  const res = await api.get<{ id: number; url: string; expires_minutes: number }>(
    `/projects/${projectId}/files/${fileId}/download`
  );
  return res.data;
}

export async function getProjectIndividualItemsCount(projectId: number): Promise<{ project_id: number; individual_items_count: number }> {
  const res = await api.get<{ project_id: number; individual_items_count: number }>(
    `/projects/${projectId}/individual-items/count`
  );
  return res.data;
}

///////////////
// USER API //
///////////////

export interface UserInfo {
  id: number;
  username: string;
  name: string | null;
  role: string;
  department: string;
  departments: string[];
  phone_number: string | null;
  phone_verified: boolean;
  profile_image_url: string | null;
}

export interface UserUpdateRequest {
  name?: string;
  phone_number?: string;
}

export interface ContributionStats {
  year: string;
  individual_items_count: number;
  content_files_count: number;
  total_files_count: number;
}

export async function getCurrentUserInfo(): Promise<UserInfo> {
  const res = await api.get<UserInfo>("/auth/me");
  return res.data;
}

export async function updateUserInfo(payload: UserUpdateRequest): Promise<UserInfo> {
  const res = await api.patch<UserInfo>("/auth/me", payload);
  return res.data;
}

export async function getUserContributions(year?: string): Promise<ContributionStats[]> {
  const params = year ? { year } : {};
  const res = await api.get<ContributionStats[]>("/auth/me/contributions", { params });
  return res.data;
}

export async function uploadProfileImage(file: File): Promise<{ profile_image_url: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await api.post<{ profile_image_url: string }>("/auth/me/profile-image", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return res.data;
}

export async function deleteProfileImage(): Promise<void> {
  await api.delete("/auth/me/profile-image");
}

///////////////
// ACTIVITY API //
///////////////

export interface ActivityItem {
  id: number;
  type: "file_upload" | "file_delete" | "review";
  timestamp: string;
  user_name: string | null;
  project_name: string;
  project_year: string | null;
  file_name: string | null;
  file_type: string | null;
  description: string;
}

export async function getRecentActivities(limit: number = 10): Promise<ActivityItem[]> {
  const res = await api.get<ActivityItem[]>("/auth/activities", { params: { limit } });
  return res.data;
}


// // FILE: frontend/src/data/files/api.ts

// import axios from "axios";

// const api = axios.create({
//   baseURL: import.meta.env.VITE_API_BASE_URL,
//   withCredentials: true,
// });

// export default api;

// ///////////////
// // INTERFACE //
// ///////////////
// // Must match backend Project schema
// export interface Project {
//   id: number;
//   name: string;
//   subject: string;
//   year: string | null;

//   // NEW: category
//   category: string;

//   // Legacy (kept for backward compatibility)
//   deadline: string | null;

//   // NEW multi deadlines
//   deadline_1: string | null;
//   deadline_2: string | null;
//   deadline_final: string | null;
// }

// export interface CreateProjectRequest {
//   name: string;
//   subject: string;
//   year: string | null;

//   // NEW: category (default handled by backend too, but we send it when UI provides)
//   category?: string;

//   // Legacy (optional)
//   deadline?: string | null;

//   // NEW multi deadlines
//   deadline_1?: string | null;
//   deadline_2?: string | null;
//   deadline_final?: string | null;
// }

// export interface UpdateProjectRequest {
//   name?: string;
//   subject?: string;
//   year?: string | null;
//   status?: string;
//   description?: string | null;

//   category?: string;

//   deadline?: string | null;
//   deadline_1?: string | null;
//   deadline_2?: string | null;
//   deadline_final?: string | null;
// }

// export interface FileAsset {
//   id: number;
//   project_id: number;
//   file_key: string;
//   original_name: string;
//   mime_type?: string | null;
//   size?: number | null;
//   created_at: string;
//   file_type?: string | null;
// }

// //////////////////////////

// export async function deleteProject(id: number): Promise<void> {
//   await api.delete(`/projects/${id}`);
// }

// export async function fetchProjects(): Promise<Project[]> {
//   const res = await api.get<Project[]>("/projects");
//   return res.data;
// }

// export async function createProject(data: CreateProjectRequest): Promise<Project> {
//   const res = await api.post<Project>("/projects", data);
//   return res.data;
// }

// export async function updateProject(
//   projectId: number,
//   data: UpdateProjectRequest
// ): Promise<Project> {
//   const res = await api.patch<Project>(`/projects/${projectId}`, data);
//   return res.data;
// }

// ///// File Asset API //////

// export async function getProjectFiles(projectId: number): Promise<FileAsset[]> {
//   const res = await api.get<FileAsset[]>(`/projects/${projectId}/files`);
//   return res.data;
// }

// export async function uploadProjectFile(
//   projectId: number,
//   file: File,
//   fileType: string
// ): Promise<{ id: number; file_key: string }> {
//   const formData = new FormData();
//   formData.append("file", file);
//   formData.append("file_type", fileType);

//   const res = await api.post<{ id: number; file_key: string }>(
//     `/projects/${projectId}/files`,
//     formData,
//     {
//       headers: {
//         "Content-Type": "multipart/form-data",
//       },
//     }
//   );
//   return res.data;
// }

// export async function deleteProjectFile(projectId: number, fileId: number): Promise<void> {
//   await api.delete(`/projects/${projectId}/files/${fileId}`);
// }

// export async function getFileDownloadUrl(projectId: number, fileId: number) {
//   const res = await api.get<{ id: number; url: string; expires_minutes: number }>(
//     `/projects/${projectId}/files/${fileId}/download`
//   );
//   return res.data;
// }
