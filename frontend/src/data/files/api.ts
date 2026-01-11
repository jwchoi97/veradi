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
