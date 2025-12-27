import React, { useEffect, useState } from "react";
import PendingApprovalsSection from "@/pages/PendingApprovalsSection";
import {
  fetchProjects,
  createProject,
  Project,
  CreateProjectRequest,
  deleteProject,
} from "../data/files/api"; // 경로는 실제 위치에 맞게 수정

export default function ProjectAdminPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [form, setForm] = useState<CreateProjectRequest>({
    name: "",
    subject: "",
    year : "",
    deadline: "",
  });

  const [listLoading, setListLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setListLoading(true);
      setError(null);
      const data = await fetchProjects();
      setProjects(data);
    } catch (e) {
      console.error(e);
      setError("프로젝트 목록을 불러오는 데 실패했습니다.");
    } finally {
      setListLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.deadline) {
      alert("프로젝트명과 마감일은 필수입니다.");
      return;
    }

    try {
      setCreateLoading(true);
      setError(null);
      const newProject = await createProject(form);
      setProjects((prev) => [...prev, newProject]);
      setForm((prev) => ({
        ...prev,
        name: "",
        deadline: "",
      }));
      setIsModalOpen(false);
    } catch (e) {
      console.error(e);
      setError("프로젝트 생성에 실패했습니다.");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("정말 삭제하시겠습니까?")) return;
    await deleteProject(id); // api.ts 에서 가져온 함수
    // 방법 1: 프론트 상태만 바로 갱신
    setProjects((prev) => prev.filter((p) => p.id !== id));

    // 또는 방법 2: 백엔드에서 다시 리스트 받아오기
    // await loadProjects();
  };

  const [year, setYear] = useState("2026");

  return (
    <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">프로젝트 관리자 페이지</h1>
          <p className="text-sm text-gray-500">
            프로젝트를 등록하고 현재 등록된 프로젝트 목록을 관리합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="rounded-xl border border-indigo-500 bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
        >
          프로젝트 등록
        </button>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <h2 className="text-lg font-semibold">등록된 프로젝트 목록</h2>
        </div>

        {listLoading ? (
          <div className="py-8 text-center text-sm text-gray-500">
            프로젝트 목록을 불러오는 중입니다...
          </div>
        ) : projects.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            등록된 프로젝트가 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">학년도</th>
                  <th className="px-3 py-2">프로젝트명</th>
                  <th className="px-3 py-2">과목</th>
                  <th className="px-3 py-2">마감일</th>
                  <th className="px-3 py-2 text-right">삭제</th> {/* ✅ 추가 */}
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 text-xs text-gray-500">{p.id}</td>
                    <td className="px-3 py-2">{p.year ?? "-"}</td>
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2">{p.subject}</td>
                    <td className="px-3 py-2">{p.deadline.split("T")[0]}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="text-red-500 hover:underline text-xs"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">새 프로젝트 등록</h2>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
               <label className="block text-sm font-medium mb-1">학년도</label>
               <select 
                  name="year"
                  value={form.year}
                  onChange={handleChange}
                //value={year} onChange={(e) => setYear(e.target.value)}
                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
               >
                 <option value="2025">2025년도</option>
                 <option value="2026">2026년도</option>
                 <option value="2027">2027년도</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  프로젝트명
                </label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  placeholder="예) 2026년 3월 모의고사"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">과목</label>
                <select
                  name="subject"
                  value={form.subject}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option value="물리">물리</option>
                  <option value="화학">화학</option>
                  <option value="생명과학">생명과학</option>
                  <option value="지구과학">지구과학</option>
                </select>
              </div><div>
                <label className="block text-sm font-medium mb-1">
                  마감일자
                </label>
                <input
                  type="date"
                  name="deadline"
                  value={form.deadline}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                  disabled={createLoading}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-60"
                  disabled={createLoading}
                >
                  {createLoading ? "등록 중..." : "등록"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="space-y-6">
        {/* 기존 관리자 페이지 내용 */}
        <PendingApprovalsSection />
      </div>
    </div>
  );
}
