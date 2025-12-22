export interface ProjectPayload {
  name: string;
  subject: string;
  description?: string;
  deadline?: string; // ISO string
  status?: string;
}

export interface Project extends ProjectPayload {
  id: number;
  created_at: string;
  updated_at: string;
  files: FileAsset[];
}

export interface FileAsset {
  id: number;
  file_key: string;
  original_name: string;
  mime_type?: string;
  size?: number;
  created_at: string;
  file_type?: string | null;
}
