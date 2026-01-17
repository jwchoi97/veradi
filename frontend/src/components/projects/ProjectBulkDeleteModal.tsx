// frontend/src/components/projects/ProjectBulkDeleteModal.tsx
import React from "react";
import type { Project } from "@/data/files/api";

type Props = {
  open: boolean;
  projects: Project[];
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ProjectBulkDeleteModal({
  open,
  projects,
  loading,
  onCancel,
  onConfirm,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200/60 bg-white/90 p-6 shadow-[0_22px_55px_-30px_rgba(15,23,42,0.60)] backdrop-blur">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">정말 삭제할까요?</h2>
        <p className="text-sm leading-6 text-slate-600 mt-1">
          아래 프로젝트 {projects.length}개를 삭제합니다. 삭제 후 복구할 수 없습니다.
        </p>

        <div className="mt-4 max-h-72 overflow-auto rounded-2xl border border-slate-200/60 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50/90 backdrop-blur text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left w-20">ID</th>
                <th className="px-3 py-2 text-left w-24">학년도</th>
                <th className="px-3 py-2 text-left">프로젝트명</th>
                <th className="px-3 py-2 text-left w-24">과목</th>
                <th className="px-3 py-2 text-left w-28">마감일</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-xs text-slate-500">{p.id}</td>
                  <td className="px-3 py-2 text-slate-700">{(p as any).year ?? "-"}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{p.name}</td>
                  <td className="px-3 py-2 text-slate-700">{p.subject}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {(p as any).deadline ? String((p as any).deadline).split("T")[0] : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            disabled={!!loading}
          >
            아니오
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 rounded-2xl bg-rose-600 px-4 text-sm font-semibold text-white shadow-[0_14px_34px_-22px_rgba(225,29,72,0.55)] hover:bg-rose-700 disabled:opacity-60"
            disabled={!!loading}
          >
            {loading ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// // frontend/src/pages/ProjectAdminPage.tsx
// import React, { useEffect, useMemo, useState } from "react";
// import PendingApprovalsSection from "@/pages/PendingApprovalsSection";
// import {
//   fetchProjects,
//   createProject,
//   Project,
//   CreateProjectRequest,
//   deleteProject,
// } from "../../data/files/api"; // adjust if needed

// function trimOrEmpty(v: unknown): string {
//   return typeof v === "string" ? v.trim() : "";
// }

// export default function ProjectAdminPage() {
//   const [projects, setProjects] = useState<Project[]>([]);
//   const [isModalOpen, setIsModalOpen] = useState(false);

//   const [form, setForm] = useState<CreateProjectRequest>({
//     name: "",
//     subject: "물리", // default to avoid empty
//     year: "2026",    // default to avoid empty
//     deadline: "",
//   });

//   const [listLoading, setListLoading] = useState(false);
//   const [createLoading, setCreateLoading] = useState(false);
//   const [error, setError] = useState<string | null>(null);

//   // derived validation (trim + required)
//   const canSubmit = useMemo(() => {
//     const name = trimOrEmpty(form.name);
//     const subject = trimOrEmpty(form.subject);
//     const deadline = trimOrEmpty(form.deadline);
//     // requirement: name + subject + deadline must exist
//     return !!name && !!subject && !!deadline && !createLoading;
//   }, [form.name, form.subject, form.deadline, createLoading]);

//   useEffect(() => {
//     void loadProjects();
//   }, []);

//   const loadProjects = async () => {
//     try {
//       setListLoading(true);
//       setError(null);
//       const data = await fetchProjects();
//       setProjects(data);
//     } catch (e) {
//       console.error(e);
//       setError("프로젝트 목록을 불러오는 데 실패했습니다.");
//     } finally {
//       setListLoading(false);
//     }
//   };

//   const handleChange = (
//     e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
//   ) => {
//     const { name, value } = e.target;
//     setForm((prev) => ({
//       ...prev,
//       [name]: value,
//     }));
//   };

//   const resetForm = () => {
//     setForm({
//       name: "",
//       subject: "물리",
//       year: "2026",
//       deadline: "",
//     });
//   };

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault();

//     // Trim before submit (prevents whitespace-only)
//     const payload: CreateProjectRequest = {
//       name: trimOrEmpty(form.name),
//       subject: trimOrEmpty(form.subject),
//       year: trimOrEmpty(form.year),
//       deadline: trimOrEmpty(form.deadline),
//     };

//     // Hard block (name/subject/deadline must exist)
//     if (!payload.name || !payload.subject || !payload.deadline) {
//       setError("프로젝트명/과목/마감일은 필수입니다.");
//       return;
//     }

//     try {
//       setCreateLoading(true);
//       setError(null);
//       const newProject = await createProject(payload);
//       setProjects((prev) => [...prev, newProject]);
//       resetForm();
//       setIsModalOpen(false);
//     } catch (e) {
//       console.error(e);
//       setError("프로젝트 생성에 실패했습니다.");
//     } finally {
//       setCreateLoading(false);
//     }
//   };

//   const handleDelete = async (id: number) => {
//     if (!window.confirm("정말 삭제하시겠습니까?")) return;
//     await deleteProject(id);
//     setProjects((prev) => prev.filter((p) => p.id !== id));
//   };

//   return (
//     <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
//       <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex items-center justify-between">
//         <div>
//           <h1 className="text-xl font-semibold">프로젝트 관리자 페이지</h1>
//           <p className="text-sm text-gray-500">
//             프로젝트를 등록하고 현재 등록된 프로젝트 목록을 관리합니다.
//           </p>
//         </div>
//         <button
//           type="button"
//           onClick={() => setIsModalOpen(true)}
//           className="rounded-xl border border-indigo-500 bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
//         >
//           프로젝트 등록
//         </button>
//       </section>

//       {error && (
//         <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
//           {error}
//         </div>
//       )}

//       <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
//         <div className="mb-3">
//           <h2 className="text-lg font-semibold">등록된 프로젝트 목록</h2>
//         </div>

//         {listLoading ? (
//           <div className="py-8 text-center text-sm text-gray-500">
//             프로젝트 목록을 불러오는 중입니다...
//           </div>
//         ) : projects.length === 0 ? (
//           <div className="py-8 text-center text-sm text-gray-500">
//             등록된 프로젝트가 없습니다.
//           </div>
//         ) : (
//           <div className="overflow-x-auto">
//             <table className="min-w-full text-sm">
//               <thead>
//                 <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
//                   <th className="px-3 py-2">ID</th>
//                   <th className="px-3 py-2">학년도</th>
//                   <th className="px-3 py-2">프로젝트명</th>
//                   <th className="px-3 py-2">과목</th>
//                   <th className="px-3 py-2">마감일</th>
//                   <th className="px-3 py-2 text-right">삭제</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {projects.map((p) => (
//                   <tr key={p.id} className="border-b last:border-b-0">
//                     <td className="px-3 py-2 text-xs text-gray-500">{p.id}</td>
//                     <td className="px-3 py-2">{(p as any).year ?? "-"}</td>
//                     <td className="px-3 py-2">{p.name}</td>
//                     <td className="px-3 py-2">{p.subject}</td>
//                     <td className="px-3 py-2">
//                       {p.deadline ? p.deadline.split("T")[0] : "-"}
//                     </td>
//                     <td className="px-3 py-2 text-right">
//                       <button
//                         onClick={() => handleDelete(p.id)}
//                         className="text-red-500 hover:underline text-xs"
//                       >
//                         삭제
//                       </button>
//                     </td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </div>
//         )}
//       </section>

//       {isModalOpen && (
//         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
//           <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
//             <h2 className="mb-4 text-lg font-semibold">새 프로젝트 등록</h2>

//             <form onSubmit={handleSubmit} className="space-y-3">
//               <div>
//                 <label className="block text-sm font-medium mb-1">학년도</label>
//                 <select
//                   name="year"
//                   value={form.year}
//                   onChange={handleChange}
//                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
//                 >
//                   <option value="2025">2025년도</option>
//                   <option value="2026">2026년도</option>
//                   <option value="2027">2027년도</option>
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-medium mb-1">
//                   프로젝트명 <span className="text-red-500">*</span>
//                 </label>
//                 <input
//                   type="text"
//                   name="name"
//                   value={form.name}
//                   onChange={handleChange}
//                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
//                   placeholder="예) 2026년 3월 모의고사"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-medium mb-1">
//                   과목 <span className="text-red-500">*</span>
//                 </label>
//                 <select
//                   name="subject"
//                   value={form.subject}
//                   onChange={handleChange}
//                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
//                 >
//                   <option value="물리">물리</option>
//                   <option value="화학">화학</option>
//                   <option value="생명과학">생명과학</option>
//                   <option value="지구과학">지구과학</option>
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-medium mb-1">
//                   마감일자 <span className="text-red-500">*</span>
//                 </label>
//                 <input
//                   type="date"
//                   name="deadline"
//                   value={form.deadline}
//                   onChange={handleChange}
//                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
//                 />
//               </div>

//               <div className="mt-4 flex justify-end gap-2">
//                 <button
//                   type="button"
//                   onClick={() => {
//                     setIsModalOpen(false);
//                     setError(null);
//                     resetForm();
//                   }}
//                   className="rounded-xl border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
//                   disabled={createLoading}
//                 >
//                   취소
//                 </button>
//                 <button
//                   type="submit"
//                   className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-60"
//                   disabled={!canSubmit}
//                   title={!canSubmit ? "필수값을 입력하세요 (프로젝트명/과목/마감일)" : ""}
//                 >
//                   {createLoading ? "등록 중..." : "등록"}
//                 </button>
//               </div>

//               {!canSubmit && (
//                 <div className="text-xs text-gray-500 pt-1">
//                   프로젝트명/과목/마감일을 입력해야 등록할 수 있습니다.
//                 </div>
//               )}
//             </form>
//           </div>
//         </div>
//       )}

//       <div className="space-y-6">
//         <PendingApprovalsSection />
//       </div>
//     </div>
//   );
// }

