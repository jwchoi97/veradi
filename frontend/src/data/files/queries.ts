import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadProjectFile } from "./api";

type Vars = { projectId: number; file: File; fileType: string; };

export function useUploadFile() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ projectId, file, fileType }: Vars) => {
      return uploadProjectFile(projectId, file, fileType);
    },
    onSuccess: (_data, vars) => {
      // 필요 시 프로젝트 상세/파일 목록을 무효화해서 즉시 새로고침
      qc.invalidateQueries({ queryKey: ["project", vars.projectId] });
      qc.invalidateQueries({ queryKey: ["projectFiles", vars.projectId] });
    },
  });
}
