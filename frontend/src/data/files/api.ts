import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:8000", // FastAPI 주소
});

///////////////
// INTERFACE //
///////////////
// Backend Project schema와 맞춰줘야 함
export interface Project {
  id: number;
  name: string;
  subject: string;
  year: string;
  deadline: string;
}

export interface CreateProjectRequest {
  name: string;
  subject: string;
  year: string;
  deadline: string;
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

export async function createProject(
  data: CreateProjectRequest
): Promise<Project> {
  const res = await api.post<Project>("/projects", data);
  return res.data;
}

///// File Asset API //////
// 방금 본 라우터에 대응
export async function getProjectFiles(
  projectId: number
): Promise<FileAsset[]> {
  const res = await api.get<FileAsset[]>(`/projects/${projectId}/files`);
  return res.data;
}

// 업로드 라우터에 대응
export async function uploadProjectFile(
  projectId: number,
  file: File,
  fileType: string, // 🔹 추가
): Promise<{ id: number; file_key: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("file_type", fileType); // 🔹 핵심

  const res = await api.post<{ id: number; file_key: string }>(
    `/projects/${projectId}/files`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );
  return res.data;
}

export async function deleteProjectFile(
  projectId: number,
  fileId: number
): Promise<void> {
  await api.delete(`/projects/${projectId}/files/${fileId}`);
}

export async function getFileDownloadUrl(projectId: number, fileId: number) {
  const res = await api.get<{ id: number; url: string; expires_minutes: number }>(
    `/projects/${projectId}/files/${fileId}/download`
  );
  return res.data;
}