// frontend/src/components/projects/BulkDeleteConfirmModal.tsx
import React from "react";
import type { Project } from "@/data/files/api";

type Props = {
  projects: Project[];
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
};

export default function BulkDeleteConfirmModal({
  projects,
  onConfirm,
  onCancel,
  loading,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-red-600 mb-3">
          프로젝트 삭제 확인
        </h2>

        <p className="text-sm mb-3">
          아래 프로젝트 <b>{projects.length}개</b>를 정말 삭제하시겠습니까?
        </p>

        <ul className="max-h-60 overflow-y-auto border rounded-md text-sm mb-4">
          {projects.map((p) => (
            <li key={p.id} className="px-3 py-2 border-b last:border-b-0">
              {p.year} / {p.subject} / {p.name}
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
