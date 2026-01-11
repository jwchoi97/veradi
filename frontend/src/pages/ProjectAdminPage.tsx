// FILE: frontend/src/pages/ProjectAdminPage.tsx

import React, { useEffect, useMemo, useState } from "react";
import PendingApprovalsSection from "@/pages/PendingApprovalsSection";
import ProjectListTable from "@/components/projects/ProjectListTable";
import type { ViewOption } from "@/components/projects/ProjectListTable";
import ProjectBulkDeleteModal from "@/components/projects/ProjectBulkDeleteModal";
import { Trash2 } from "lucide-react";

import { getAuthedUser } from "@/auth";

import {
  fetchProjects,
  createProject,
  Project,
  CreateProjectRequest,
  deleteProject,
} from "../data/files/api";

function trimOrEmpty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function uniqStr(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const v = String(x || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Department enum values (backend Department) */
type DepartmentCode =
  | "ADMIN"
  | "PHYSICS_1"
  | "CHEMISTRY_1"
  | "BIOLOGY_1"
  | "EARTH_1"
  | "CHEMISTRY_2"
  | "SOCIOCULTURE"
  | "MATH";

const departmentLabels: Record<DepartmentCode, string> = {
  ADMIN: "관리자",
  PHYSICS_1: "물리1",
  CHEMISTRY_1: "화학1",
  BIOLOGY_1: "생물1",
  EARTH_1: "지구1",
  CHEMISTRY_2: "화학2",
  SOCIOCULTURE: "사회문화",
  MATH: "수학",
};

function ownerDeptLabel(v: string) {
  const key = v as DepartmentCode;
  return departmentLabels[key] ?? v;
}

export default function ProjectAdminPage() {
  const me = getAuthedUser();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [form, setForm] = useState<CreateProjectRequest & { owner_department?: string }>({
    name: "",
    subject: "물리",
    year: "2026",

    category: "기타",

    deadline_1: "",
    deadline_2: "",
    deadline_final: "",

    deadline: "",

    owner_department: "",
  });

  const [listLoading, setListLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  const years = useMemo(() => ["전체", "2025", "2026", "2027"], []);
  const subjects = useMemo(() => ["전체", "물리", "화학", "생명과학", "지구과학"], []);
  const viewOptions = useMemo<ViewOption[]>(() => ["진행중인 프로젝트만", "모두 보기"], []);

  const categories = useMemo(() => ["시대인재", "시대인재북스", "기타"], []);

  const role = (me?.role ?? "MEMBER") as "ADMIN" | "LEAD" | "MEMBER" | "PENDING";
  const isAdmin = role === "ADMIN";
  const isLead = role === "LEAD";

  // ✅ multi departments (preferred) + legacy fallback
  const myDepartments = useMemo(() => {
    const multi = Array.isArray((me as any)?.departments) ? (((me as any).departments as string[]) ?? []) : [];
    const legacy = typeof (me as any)?.department === "string" ? [String((me as any).department)] : [];
    return uniqStr([...multi, ...legacy]).filter((d) => d && d !== "ADMIN");
  }, [me]);

  // ADMIN/LEAD can open create modal (UX gating)
  const canCreateAny = useMemo(() => isAdmin || isLead, [isAdmin, isLead]);

  const leadOwnerOptions = useMemo(() => {
    return myDepartments.length > 0 ? myDepartments : [];
  }, [myDepartments]);

  const canSubmit = useMemo(() => {
    const name = trimOrEmpty(form.name);
    const subject = trimOrEmpty(form.subject);
    const deadlineFinal = trimOrEmpty(form.deadline_final ?? "");

    if (!name || !subject || !deadlineFinal) return false;
    if (!canCreateAny) return false;

    if (isLead) {
      const od = trimOrEmpty((form as any).owner_department ?? "");
      if (!od) return false;
      if (!myDepartments.includes(od)) return false;
    }

    return !createLoading;
  }, [
    form.name,
    form.subject,
    form.deadline_final,
    createLoading,
    canCreateAny,
    isLead,
    myDepartments,
    (form as any).owner_department,
  ]);

  useEffect(() => {
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProjects = async () => {
    try {
      setListLoading(true);
      setError(null);
      const data = await fetchProjects();
      setProjects(data);
      setSelectedIds(new Set());
    } catch (e) {
      console.error(e);
      setError("프로젝트 목록을 불러오는 데 실패했습니다.");
    } finally {
      setListLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setForm({
      name: "",
      subject: "물리",
      year: "2026",

      category: "기타",

      deadline_1: "",
      deadline_2: "",
      deadline_final: "",

      deadline: "",

      owner_department: "",
    });
  };

  const ensureLeadOwnerDefault = () => {
    if (!isLead) return;
    setForm((prev) => {
      const cur = trimOrEmpty((prev as any).owner_department ?? "");
      if (cur && myDepartments.includes(cur)) return prev;
      const first = leadOwnerOptions[0] ?? "";
      return { ...prev, owner_department: first };
    });
  };

  const openCreateModal = () => {
    if (!canCreateAny) {
      alert("권한이 없습니다. (ADMIN/LEAD만 프로젝트를 생성할 수 있습니다.)");
      return;
    }
    setError(null);
    setIsModalOpen(true);
    setTimeout(() => ensureLeadOwnerDefault(), 0);
  };

  // ✅ LEAD: delete only own dept projects (requires project.owner_department to be set)
  const canDeleteProject = (p: Project) => {
    if (isAdmin) return true;
    if (!isLead) return false;

    const od = trimOrEmpty((p as any).owner_department ?? "");
    if (!od) return false;
    return myDepartments.includes(od);
  };

  const denyMsgForProject = (p: Project) => {
    if (isAdmin) return "";
    if (!isLead) return "권한이 없습니다.";
    const od = trimOrEmpty((p as any).owner_department ?? "");
    if (!od) return "이 프로젝트는 소속팀 정보가 없어 LEAD 권한으로 관리할 수 없습니다.";
    return "다른 팀 프로젝트는 삭제할 수 없습니다.";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canCreateAny) {
      alert("권한이 없습니다. (ADMIN/LEAD만 프로젝트를 생성할 수 있습니다.)");
      return;
    }

    const ownerDept = trimOrEmpty((form as any).owner_department ?? "");

    if (isLead) {
      if (!ownerDept) {
        setError("LEAD 계정은 프로젝트 소속 팀을 반드시 선택해야 합니다.");
        return;
      }
      if (!myDepartments.includes(ownerDept)) {
        setError("선택한 팀이 본인 소속 팀이 아닙니다.");
        return;
      }
    }

    const payload: CreateProjectRequest = {
      name: trimOrEmpty(form.name),
      subject: trimOrEmpty(form.subject),
      year: trimOrEmpty(form.year) || null,

      category: trimOrEmpty((form as any).category ?? "") || "기타",

      deadline_1: trimOrEmpty((form as any).deadline_1 ?? "") || null,
      deadline_2: trimOrEmpty((form as any).deadline_2 ?? "") || null,
      deadline_final: trimOrEmpty((form as any).deadline_final ?? "") || null,

      // Legacy compatibility
      deadline: trimOrEmpty((form as any).deadline_final ?? "") || null,
    };

    if (!payload.name || !payload.subject || !payload.deadline_final) {
      setError("프로젝트명/과목/최종 마감일은 필수입니다.");
      return;
    }

    try {
      setCreateLoading(true);
      setError(null);

      // ✅ include owner_department (backend must store it)
      const payloadWithOwner = payload as any;
      payloadWithOwner.owner_department = isLead ? ownerDept : ownerDept || null;

      const newProject = await createProject(payloadWithOwner);
      setProjects((prev) => [...prev, newProject]);
      resetForm();
      setIsModalOpen(false);
    } catch (e) {
      console.error(e);
      setError("프로젝트 생성에 실패했습니다.");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDeleteOne = async (p: Project) => {
    if (!canDeleteProject(p)) {
      alert(denyMsgForProject(p));
      return;
    }
    if (!window.confirm("정말 삭제하시겠습니까?")) return;

    try {
      await deleteProject(p.id);
      setProjects((prev) => prev.filter((x) => x.id !== p.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    } catch (e) {
      console.error(e);
      setError("프로젝트 삭제에 실패했습니다.");
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = (idsOnPage: number[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = idsOnPage.every((id) => next.has(id));
      if (allSelected) idsOnPage.forEach((id) => next.delete(id));
      else idsOnPage.forEach((id) => next.add(id));
      return next;
    });
  };

  const selectedProjects = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const map = new Map(projects.map((p) => [p.id, p]));
    return Array.from(selectedIds)
      .map((id) => map.get(id))
      .filter(Boolean) as Project[];
  }, [projects, selectedIds]);

  const openBulkDelete = () => {
    if (selectedIds.size === 0) return;

    if (!isAdmin && !isLead) {
      alert("권한이 없습니다.");
      return;
    }

    if (isLead) {
      const denied = selectedProjects.filter((p) => !canDeleteProject(p));
      if (denied.length > 0) {
        alert(
          `선택 항목 중 삭제 권한이 없는 프로젝트가 포함되어 있어 진행할 수 없습니다.\n(권한 없음: ${denied.length}개)`
        );
        return;
      }
    }

    setIsDeleteModalOpen(true);
  };

  const confirmBulkDelete = async () => {
    if (selectedProjects.length === 0) {
      setIsDeleteModalOpen(false);
      return;
    }

    if (isLead) {
      const denied = selectedProjects.filter((p) => !canDeleteProject(p));
      if (denied.length > 0) {
        alert(
          `선택 항목 중 삭제 권한이 없는 프로젝트가 포함되어 있어 진행할 수 없습니다.\n(권한 없음: ${denied.length}개)`
        );
        setIsDeleteModalOpen(false);
        return;
      }
    } else if (!isAdmin) {
      alert("권한이 없습니다.");
      setIsDeleteModalOpen(false);
      return;
    }

    try {
      setBulkDeleteLoading(true);
      setError(null);

      for (const p of selectedProjects) {
        await deleteProject(p.id);
      }

      const deleted = new Set(selectedProjects.map((p) => p.id));
      setProjects((prev) => prev.filter((p) => !deleted.has(p.id)));
      setSelectedIds(new Set());
      setIsDeleteModalOpen(false);
    } catch (e) {
      console.error(e);
      setError("프로젝트 일괄 삭제에 실패했습니다.");
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  return (
    <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">프로젝트 관리자 페이지</h1>
          <p className="text-sm text-gray-500">프로젝트를 등록하고 현재 등록된 프로젝트 목록을 관리합니다.</p>

          <div className="mt-2 text-xs text-gray-500">
            {isAdmin ? (
              <span>권한: ADMIN (전체 프로젝트 생성/삭제 가능)</span>
            ) : isLead ? (
              <span>
                권한: LEAD (내 소속 팀만 생성/삭제 가능) · 내 팀:{" "}
                <span className="text-gray-700">
                  {myDepartments.map(ownerDeptLabel).join(", ") || "-"}
                </span>
              </span>
            ) : (
              <span className="text-red-600">권한: 없음 (프로젝트 생성/삭제 불가)</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openBulkDelete}
            disabled={selectedIds.size === 0 || (!isAdmin && !isLead)}
            title={
              !isAdmin && !isLead
                ? "권한이 없습니다"
                : selectedIds.size === 0
                ? "삭제할 프로젝트를 선택하세요"
                : "선택 항목 삭제"
            }
            className={[
              "rounded-xl border px-3 py-2 text-sm font-medium inline-flex items-center gap-2",
              selectedIds.size === 0 || (!isAdmin && !isLead)
                ? "border-gray-200 text-gray-300"
                : "border-red-200 text-red-700 hover:bg-red-50",
            ].join(" ")}
          >
            <Trash2 className="h-4 w-4" />
            삭제
            {selectedIds.size > 0 ? <span className="text-xs">({selectedIds.size})</span> : null}
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            disabled={!canCreateAny}
            title={!canCreateAny ? "권한이 없습니다 (ADMIN/LEAD만 가능)" : "프로젝트 등록"}
            className={[
              "rounded-xl border px-4 py-2 text-sm font-medium text-white",
              canCreateAny ? "border-indigo-500 bg-indigo-500 hover:bg-indigo-600" : "border-gray-300 bg-gray-300",
            ].join(" ")}
          >
            프로젝트 등록
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>
      )}

      {listLoading ? (
        <div className="rounded-2xl border bg-white p-4 shadow-sm text-sm text-gray-500">
          프로젝트 목록을 불러오는 중입니다...
        </div>
      ) : (
        <ProjectListTable
          title="등록된 프로젝트 목록"
          projects={projects}
          years={years}
          subjects={subjects}
          viewOptions={viewOptions}
          actionHeader="삭제"
          renderAction={(p) => {
            const allowed = canDeleteProject(p);
            return (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDeleteOne(p);
                }}
                className={[
                  "text-xs",
                  allowed ? "text-red-500 hover:underline" : "text-gray-300 cursor-not-allowed",
                ].join(" ")}
                title={allowed ? "단일 삭제" : denyMsgForProject(p)}
                disabled={!allowed}
              >
                삭제
              </button>
            );
          }}
          pageSize={10}
          selectable
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAllOnPage}
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">새 프로젝트 등록</h2>

            {!canCreateAny ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                권한이 없습니다. (ADMIN/LEAD만 프로젝트를 생성할 수 있습니다.)
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-3">
              {isLead ? (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    프로젝트 소속 팀 <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="owner_department"
                    value={(form as any).owner_department ?? ""}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    {leadOwnerOptions.length === 0 ? (
                      <option value="" disabled>
                        (소속 팀이 없습니다) 관리자에게 문의하세요
                      </option>
                    ) : null}
                    {leadOwnerOptions.map((d) => (
                      <option key={d} value={d}>
                        {ownerDeptLabel(d)}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-gray-500 mt-1">LEAD는 본인 소속 팀 프로젝트만 생성할 수 있어요.</div>
                </div>
              ) : isAdmin ? (
                <div>
                  <label className="block text-sm font-medium mb-1">프로젝트 소속 팀 (선택)</label>
                  <select
                    name="owner_department"
                    value={(form as any).owner_department ?? ""}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">(미지정)</option>
                    {(Object.keys(departmentLabels) as Array<keyof typeof departmentLabels>)
                      .filter((k) => k !== "ADMIN")
                      .map((k) => (
                        <option key={k} value={k}>
                          {departmentLabels[k]}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}

              <div>
                <label className="block text-sm font-medium mb-1">학년도</label>
                <select
                  name="year"
                  value={(form as any).year ?? ""}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option value="2025">2025년도</option>
                  <option value="2026">2026년도</option>
                  <option value="2027">2027년도</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">카테고리</label>
                <select
                  name="category"
                  value={(form as any).category ?? "기타"}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  프로젝트명 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={(form as any).name ?? ""}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  placeholder="예) 2026년 3월 모의고사"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  과목 <span className="text-red-500">*</span>
                </label>
                <select
                  name="subject"
                  value={(form as any).subject ?? ""}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option value="물리">물리</option>
                  <option value="화학">화학</option>
                  <option value="생명과학">생명과학</option>
                  <option value="지구과학">지구과학</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">1차 마감일</label>
                <input
                  type="date"
                  name="deadline_1"
                  value={(form as any).deadline_1 ?? ""}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">2차 마감일</label>
                <input
                  type="date"
                  name="deadline_2"
                  value={(form as any).deadline_2 ?? ""}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  최종 마감일 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="deadline_final"
                  value={(form as any).deadline_final ?? ""}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setError(null);
                    resetForm();
                  }}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                  disabled={createLoading}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-60"
                  disabled={!canSubmit}
                  title={!canSubmit ? "필수값을 입력하세요 (프로젝트명/과목/최종 마감일/팀)" : ""}
                >
                  {createLoading ? "등록 중..." : "등록"}
                </button>
              </div>

              {!canSubmit && (
                <div className="text-xs text-gray-500 pt-1">
                  프로젝트명/과목/최종 마감일{isLead ? "/프로젝트 소속 팀" : ""}을 입력해야 등록할 수 있습니다.
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      <ProjectBulkDeleteModal
        open={isDeleteModalOpen}
        projects={selectedProjects}
        loading={bulkDeleteLoading}
        onCancel={() => setIsDeleteModalOpen(false)}
        onConfirm={() => void confirmBulkDelete()}
      />

      <div className="space-y-6">
        <PendingApprovalsSection />
      </div>
    </div>
  );
}


// // FILE: frontend/src/pages/ProjectAdminPage.tsx

// import React, { useEffect, useMemo, useState } from "react";
// import PendingApprovalsSection from "@/pages/PendingApprovalsSection";
// import ProjectListTable from "@/components/projects/ProjectListTable";
// import type { ViewOption } from "@/components/projects/ProjectListTable";
// import ProjectBulkDeleteModal from "@/components/projects/ProjectBulkDeleteModal";
// import { Trash2 } from "lucide-react";

// import {
//   fetchProjects,
//   createProject,
//   Project,
//   CreateProjectRequest,
//   deleteProject,
// } from "../data/files/api";

// function trimOrEmpty(v: unknown): string {
//   return typeof v === "string" ? v.trim() : "";
// }

// /** -----------------------------
//  * Auth user (best-effort loader)
//  * ------------------------------
//  * We don't know your exact auth storage key, so we try common keys.
//  */
// type AuthRole = "ADMIN" | "LEAD" | "MEMBER" | "PENDING";
// type AuthUser = {
//   id: number;
//   username: string;
//   name?: string | null;
//   role: AuthRole;

//   // NEW (multi) preferred
//   departments?: string[] | null;

//   // legacy fallback
//   department?: string | null;
// };

// function safeJsonParse<T>(s: string | null): T | null {
//   if (!s) return null;
//   try {
//     return JSON.parse(s) as T;
//   } catch {
//     return null;
//   }
// }

// function loadAuthUser(): AuthUser | null {
//   const keys = [
//     "authUser",
//     "currentUser",
//     "user",
//     "auth",
//     "loginUser",
//     "session",
//   ];

//   const storages = [window.localStorage, window.sessionStorage];

//   for (const st of storages) {
//     for (const k of keys) {
//       const raw = st.getItem(k);
//       const obj = safeJsonParse<any>(raw);
//       if (!obj) continue;

//       // direct
//       if (obj?.role && (obj?.id != null || obj?.user?.id != null)) {
//         const u = (obj?.user ?? obj) as any;
//         const role = String(u.role ?? obj.role) as AuthRole;
//         if (!role) continue;

//         const departments =
//           (Array.isArray(u.departments) ? u.departments : null) ??
//           (Array.isArray(obj.departments) ? obj.departments : null) ??
//           null;

//         const department =
//           (typeof u.department === "string" ? u.department : null) ??
//           (typeof obj.department === "string" ? obj.department : null) ??
//           null;

//         const id = Number(u.id ?? obj.id);
//         if (!Number.isFinite(id)) continue;

//         return {
//           id,
//           username: String(u.username ?? obj.username ?? ""),
//           name: u.name ?? obj.name ?? null,
//           role,
//           departments,
//           department,
//         };
//       }
//     }
//   }

//   return null;
// }

// /** Department enum values (backend Department) */
// type DepartmentCode =
//   | "ADMIN"
//   | "PHYSICS_1"
//   | "CHEMISTRY_1"
//   | "BIOLOGY_1"
//   | "EARTH_1"
//   | "CHEMISTRY_2"
//   | "SOCIOCULTURE"
//   | "MATH";

// const departmentLabels: Record<DepartmentCode, string> = {
//   ADMIN: "관리자",
//   PHYSICS_1: "물리1",
//   CHEMISTRY_1: "화학1",
//   BIOLOGY_1: "생물1",
//   EARTH_1: "지구1",
//   CHEMISTRY_2: "화학2",
//   SOCIOCULTURE: "사회문화",
//   MATH: "수학",
// };

// function uniqStr(list: string[]): string[] {
//   const out: string[] = [];
//   const seen = new Set<string>();
//   for (const x of list) {
//     const v = String(x || "").trim();
//     if (!v) continue;
//     if (seen.has(v)) continue;
//     seen.add(v);
//     out.push(v);
//   }
//   return out;
// }

// export default function ProjectAdminPage() {
//   const [authUser, setAuthUser] = useState<AuthUser | null>(null);

//   const [projects, setProjects] = useState<Project[]>([]);
//   const [isModalOpen, setIsModalOpen] = useState(false);

//   const [form, setForm] = useState<CreateProjectRequest & { owner_department?: string }>({
//     name: "",
//     subject: "물리",
//     year: "2026",

//     category: "기타",

//     // NEW multi deadlines
//     deadline_1: "",
//     deadline_2: "",
//     deadline_final: "",

//     // Legacy (optional): keep sending for backward compatibility; we map it to deadline_final at submit
//     deadline: "",

//     // ✅ NEW: which team owns this project (for LEAD restriction)
//     owner_department: "",
//   });

//   const [listLoading, setListLoading] = useState(false);
//   const [createLoading, setCreateLoading] = useState(false);
//   const [error, setError] = useState<string | null>(null);

//   // selection
//   const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
//   const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
//   const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

//   const years = useMemo(() => ["전체", "2025", "2026", "2027"], []);
//   const subjects = useMemo(() => ["전체", "물리", "화학", "생명과학", "지구과학"], []);
//   const viewOptions = useMemo<ViewOption[]>(() => ["진행중인 프로젝트만", "모두 보기"], []);

//   // Category list (easy to change later)
//   const categories = useMemo(() => ["시대인재", "시대인재북스", "기타"], []);

//   const role = authUser?.role ?? "MEMBER";
//   const isAdmin = role === "ADMIN";
//   const isLead = role === "LEAD";

//   const myDepartments = useMemo(() => {
//     const fromMulti = Array.isArray(authUser?.departments) ? authUser!.departments! : [];
//     const fromLegacy = authUser?.department ? [authUser.department] : [];
//     return uniqStr([...fromMulti, ...fromLegacy]).filter((d) => d !== "ADMIN");
//   }, [authUser]);

//   // LEAD: can only create/delete for own departments
//   const canCreateAny = useMemo(() => isAdmin || isLead, [isAdmin, isLead]);

//   const leadOwnerOptions = useMemo(() => {
//     // only allow valid enum-like strings; if unknown, still show raw value
//     const opts = myDepartments.length > 0 ? myDepartments : [];
//     return opts;
//   }, [myDepartments]);

//   const canSubmit = useMemo(() => {
//     const name = trimOrEmpty(form.name);
//     const subject = trimOrEmpty(form.subject);
//     const deadlineFinal = trimOrEmpty(form.deadline_final ?? "");

//     if (!name || !subject || !deadlineFinal) return false;
//     if (!canCreateAny) return false;

//     // LEAD must choose owner_department and it must be in their departments
//     if (isLead) {
//       const od = trimOrEmpty((form as any).owner_department ?? "");
//       if (!od) return false;
//       if (!myDepartments.includes(od)) return false;
//     }

//     return !createLoading;
//   }, [
//     form.name,
//     form.subject,
//     form.deadline_final,
//     createLoading,
//     canCreateAny,
//     isLead,
//     myDepartments,
//     (form as any).owner_department,
//   ]);

//   useEffect(() => {
//     setAuthUser(loadAuthUser());
//     void loadProjects();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   const loadProjects = async () => {
//     try {
//       setListLoading(true);
//       setError(null);
//       const data = await fetchProjects();
//       setProjects(data);
//       setSelectedIds(new Set());
//     } catch (e) {
//       console.error(e);
//       setError("프로젝트 목록을 불러오는 데 실패했습니다.");
//     } finally {
//       setListLoading(false);
//     }
//   };

//   const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
//     const { name, value } = e.target;
//     setForm((prev) => ({ ...prev, [name]: value }));
//   };

//   const resetForm = () => {
//     setForm({
//       name: "",
//       subject: "물리",
//       year: "2026",

//       category: "기타",

//       deadline_1: "",
//       deadline_2: "",
//       deadline_final: "",

//       deadline: "",

//       owner_department: "",
//     });
//   };

//   const ensureLeadOwnerDefault = () => {
//     if (!isLead) return;
//     setForm((prev) => {
//       const cur = trimOrEmpty((prev as any).owner_department ?? "");
//       if (cur && myDepartments.includes(cur)) return prev;
//       const first = leadOwnerOptions[0] ?? "";
//       return { ...prev, owner_department: first };
//     });
//   };

//   const openCreateModal = () => {
//     if (!canCreateAny) {
//       alert("권한이 없습니다. (ADMIN/LEAD만 프로젝트를 생성할 수 있습니다.)");
//       return;
//     }
//     setError(null);
//     setIsModalOpen(true);
//     // set default owner dept for LEAD
//     setTimeout(() => ensureLeadOwnerDefault(), 0);
//   };

//   const canDeleteProject = (p: Project) => {
//     if (isAdmin) return true;
//     if (!isLead) return false;

//     const od = trimOrEmpty((p as any).owner_department ?? "");
//     if (!od) return false; // safety: old rows without owner_department are not manageable by LEAD
//     return myDepartments.includes(od);
//   };

//   const denyMsgForProject = (p: Project) => {
//     if (isAdmin) return "";
//     if (!isLead) return "권한이 없습니다.";
//     const od = trimOrEmpty((p as any).owner_department ?? "");
//     if (!od) return "이 프로젝트는 소속팀 정보가 없어 LEAD 권한으로 관리할 수 없습니다.";
//     return "다른 팀 프로젝트는 삭제할 수 없습니다.";
//   };

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault();

//     if (!canCreateAny) {
//       alert("권한이 없습니다. (ADMIN/LEAD만 프로젝트를 생성할 수 있습니다.)");
//       return;
//     }

//     const ownerDept = trimOrEmpty((form as any).owner_department ?? "");

//     if (isLead) {
//       if (!ownerDept) {
//         setError("LEAD 계정은 프로젝트 소속 팀을 반드시 선택해야 합니다.");
//         return;
//       }
//       if (!myDepartments.includes(ownerDept)) {
//         setError("선택한 팀이 본인 소속 팀이 아닙니다.");
//         return;
//       }
//     }

//     const payload: CreateProjectRequest = {
//       name: trimOrEmpty(form.name),
//       subject: trimOrEmpty(form.subject),
//       year: trimOrEmpty(form.year) || null,

//       category: trimOrEmpty((form as any).category ?? "") || "기타",

//       deadline_1: trimOrEmpty((form as any).deadline_1 ?? "") || null,
//       deadline_2: trimOrEmpty((form as any).deadline_2 ?? "") || null,
//       deadline_final: trimOrEmpty((form as any).deadline_final ?? "") || null,

//       // Legacy: send final as deadline for compatibility
//       deadline: trimOrEmpty((form as any).deadline_final ?? "") || null,
//     };

//     if (!payload.name || !payload.subject || !payload.deadline_final) {
//       setError("프로젝트명/과목/최종 마감일은 필수입니다.");
//       return;
//     }

//     try {
//       setCreateLoading(true);
//       setError(null);

//       // ✅ send owner_department (backend should store projects.owner_department)
//       const payloadWithOwner = payload as any;
//       payloadWithOwner.owner_department = isLead ? ownerDept : ownerDept || null;

//       const newProject = await createProject(payloadWithOwner);
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

//   // single delete
//   const handleDeleteOne = async (p: Project) => {
//     if (!canDeleteProject(p)) {
//       alert(denyMsgForProject(p));
//       return;
//     }

//     if (!window.confirm("정말 삭제하시겠습니까?")) return;

//     try {
//       await deleteProject(p.id);
//       setProjects((prev) => prev.filter((x) => x.id !== p.id));
//       setSelectedIds((prev) => {
//         const next = new Set(prev);
//         next.delete(p.id);
//         return next;
//       });
//     } catch (e) {
//       console.error(e);
//       setError("프로젝트 삭제에 실패했습니다.");
//     }
//   };

//   const toggleSelect = (id: number) => {
//     setSelectedIds((prev) => {
//       const next = new Set(prev);
//       if (next.has(id)) next.delete(id);
//       else next.add(id);
//       return next;
//     });
//   };

//   const toggleSelectAllOnPage = (idsOnPage: number[]) => {
//     setSelectedIds((prev) => {
//       const next = new Set(prev);
//       const allSelected = idsOnPage.every((id) => next.has(id));
//       if (allSelected) idsOnPage.forEach((id) => next.delete(id));
//       else idsOnPage.forEach((id) => next.add(id));
//       return next;
//     });
//   };

//   const selectedProjects = useMemo(() => {
//     if (selectedIds.size === 0) return [];
//     const map = new Map(projects.map((p) => [p.id, p]));
//     return Array.from(selectedIds)
//       .map((id) => map.get(id))
//       .filter(Boolean) as Project[];
//   }, [projects, selectedIds]);

//   const openBulkDelete = () => {
//     if (selectedIds.size === 0) return;

//     if (!isAdmin && !isLead) {
//       alert("권한이 없습니다.");
//       return;
//     }

//     // LEAD: if any unauthorized project selected, block with warning
//     if (isLead) {
//       const denied = selectedProjects.filter((p) => !canDeleteProject(p));
//       if (denied.length > 0) {
//         alert(
//           `선택 항목 중 삭제 권한이 없는 프로젝트가 포함되어 있어 진행할 수 없습니다.\n(권한 없음: ${denied.length}개)`
//         );
//         return;
//       }
//     }

//     setIsDeleteModalOpen(true);
//   };

//   const confirmBulkDelete = async () => {
//     if (selectedProjects.length === 0) {
//       setIsDeleteModalOpen(false);
//       return;
//     }

//     // Safety check again
//     if (isLead) {
//       const denied = selectedProjects.filter((p) => !canDeleteProject(p));
//       if (denied.length > 0) {
//         alert(
//           `선택 항목 중 삭제 권한이 없는 프로젝트가 포함되어 있어 진행할 수 없습니다.\n(권한 없음: ${denied.length}개)`
//         );
//         setIsDeleteModalOpen(false);
//         return;
//       }
//     } else if (!isAdmin) {
//       alert("권한이 없습니다.");
//       setIsDeleteModalOpen(false);
//       return;
//     }

//     try {
//       setBulkDeleteLoading(true);
//       setError(null);

//       for (const p of selectedProjects) {
//         await deleteProject(p.id);
//       }

//       const deleted = new Set(selectedProjects.map((p) => p.id));
//       setProjects((prev) => prev.filter((p) => !deleted.has(p.id)));
//       setSelectedIds(new Set());
//       setIsDeleteModalOpen(false);
//     } catch (e) {
//       console.error(e);
//       setError("프로젝트 일괄 삭제에 실패했습니다.");
//     } finally {
//       setBulkDeleteLoading(false);
//     }
//   };

//   const ownerDeptLabel = (v: string) => {
//     const key = v as DepartmentCode;
//     return departmentLabels[key] ?? v;
//   };

//   return (
//     <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
//       <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex items-center justify-between">
//         <div>
//           <h1 className="text-xl font-semibold">프로젝트 관리자 페이지</h1>
//           <p className="text-sm text-gray-500">
//             프로젝트를 등록하고 현재 등록된 프로젝트 목록을 관리합니다.
//           </p>

//           {/* 권한 안내 */}
//           <div className="mt-2 text-xs text-gray-500">
//             {isAdmin ? (
//               <span>권한: ADMIN (전체 프로젝트 생성/삭제 가능)</span>
//             ) : isLead ? (
//               <span>
//                 권한: LEAD (내 소속 팀만 생성/삭제 가능) · 내 팀:{" "}
//                 <span className="text-gray-700">{myDepartments.map(ownerDeptLabel).join(", ") || "-"}</span>
//               </span>
//             ) : (
//               <span className="text-red-600">권한: 없음 (프로젝트 생성/삭제 불가)</span>
//             )}
//           </div>
//         </div>

//         <div className="flex items-center gap-2">
//           <button
//             type="button"
//             onClick={openBulkDelete}
//             disabled={selectedIds.size === 0 || (!isAdmin && !isLead)}
//             title={
//               !isAdmin && !isLead
//                 ? "권한이 없습니다"
//                 : selectedIds.size === 0
//                 ? "삭제할 프로젝트를 선택하세요"
//                 : "선택 항목 삭제"
//             }
//             className={[
//               "rounded-xl border px-3 py-2 text-sm font-medium inline-flex items-center gap-2",
//               selectedIds.size === 0 || (!isAdmin && !isLead)
//                 ? "border-gray-200 text-gray-300"
//                 : "border-red-200 text-red-700 hover:bg-red-50",
//             ].join(" ")}
//           >
//             <Trash2 className="h-4 w-4" />
//             삭제
//             {selectedIds.size > 0 ? <span className="text-xs">({selectedIds.size})</span> : null}
//           </button>

//           <button
//             type="button"
//             onClick={openCreateModal}
//             disabled={!canCreateAny}
//             title={!canCreateAny ? "권한이 없습니다 (ADMIN/LEAD만 가능)" : "프로젝트 등록"}
//             className={[
//               "rounded-xl border px-4 py-2 text-sm font-medium text-white",
//               canCreateAny ? "border-indigo-500 bg-indigo-500 hover:bg-indigo-600" : "border-gray-300 bg-gray-300",
//             ].join(" ")}
//           >
//             프로젝트 등록
//           </button>
//         </div>
//       </section>

//       {error && (
//         <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
//           {error}
//         </div>
//       )}

//       {listLoading ? (
//         <div className="rounded-2xl border bg-white p-4 shadow-sm text-sm text-gray-500">
//           프로젝트 목록을 불러오는 중입니다...
//         </div>
//       ) : (
//         <ProjectListTable
//           title="등록된 프로젝트 목록"
//           projects={projects}
//           years={years}
//           subjects={subjects}
//           viewOptions={viewOptions}
//           actionHeader="삭제"
//           renderAction={(p) => {
//             const allowed = canDeleteProject(p);
//             return (
//               <button
//                 onClick={(e) => {
//                   e.stopPropagation();
//                   void handleDeleteOne(p);
//                 }}
//                 className={[
//                   "text-xs",
//                   allowed ? "text-red-500 hover:underline" : "text-gray-300 cursor-not-allowed",
//                 ].join(" ")}
//                 title={allowed ? "단일 삭제" : denyMsgForProject(p)}
//                 disabled={!allowed}
//               >
//                 삭제
//               </button>
//             );
//           }}
//           pageSize={10}
//           selectable
//           selectedIds={selectedIds}
//           onToggleSelect={toggleSelect}
//           onToggleSelectAll={toggleSelectAllOnPage}
//         />
//       )}

//       {isModalOpen && (
//         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
//           <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
//             <h2 className="mb-4 text-lg font-semibold">새 프로젝트 등록</h2>

//             {!canCreateAny ? (
//               <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
//                 권한이 없습니다. (ADMIN/LEAD만 프로젝트를 생성할 수 있습니다.)
//               </div>
//             ) : null}

//             <form onSubmit={handleSubmit} className="space-y-3">
//               {/* ✅ LEAD 소속팀 제한: owner_department 선택 필수 */}
//               {isLead ? (
//                 <div>
//                   <label className="block text-sm font-medium mb-1">
//                     프로젝트 소속 팀 <span className="text-red-500">*</span>
//                   </label>
//                   <select
//                     name="owner_department"
//                     value={(form as any).owner_department ?? ""}
//                     onChange={handleChange}
//                     className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
//                   >
//                     {leadOwnerOptions.length === 0 ? (
//                       <option value="" disabled>
//                         (소속 팀이 없습니다) 관리자에게 문의하세요
//                       </option>
//                     ) : null}
//                     {leadOwnerOptions.map((d) => (
//                       <option key={d} value={d}>
//                         {ownerDeptLabel(d)}
//                       </option>
//                     ))}
//                   </select>
//                   <div className="text-xs text-gray-500 mt-1">
//                     LEAD는 본인 소속 팀 프로젝트만 생성할 수 있어요.
//                   </div>
//                 </div>
//               ) : isAdmin ? (
//                 <div>
//                   <label className="block text-sm font-medium mb-1">프로젝트 소속 팀 (선택)</label>
//                   <select
//                     name="owner_department"
//                     value={(form as any).owner_department ?? ""}
//                     onChange={handleChange}
//                     className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
//                   >
//                     <option value="">(미지정)</option>
//                     {(
//                       Object.keys(departmentLabels) as Array<keyof typeof departmentLabels>
//                     )
//                       .filter((k) => k !== "ADMIN")
//                       .map((k) => (
//                         <option key={k} value={k}>
//                           {departmentLabels[k]}
//                         </option>
//                       ))}
//                   </select>
//                 </div>
//               ) : null}

//               <div>
//                 <label className="block text-sm font-medium mb-1">학년도</label>
//                 <select
//                   name="year"
//                   value={(form as any).year ?? ""}
//                   onChange={handleChange}
//                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
//                 >
//                   <option value="2025">2025년도</option>
//                   <option value="2026">2026년도</option>
//                   <option value="2027">2027년도</option>
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-medium mb-1">카테고리</label>
//                 <select
//                   name="category"
//                   value={(form as any).category ?? "기타"}
//                   onChange={handleChange}
//                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
//                 >
//                   {categories.map((c) => (
//                     <option key={c} value={c}>
//                       {c}
//                     </option>
//                   ))}
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-medium mb-1">
//                   프로젝트명 <span className="text-red-500">*</span>
//                 </label>
//                 <input
//                   type="text"
//                   name="name"
//                   value={(form as any).name ?? ""}
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
//                   value={(form as any).subject ?? ""}
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
//                 <label className="block text-sm font-medium mb-1">1차 마감일</label>
//                 <input
//                   type="date"
//                   name="deadline_1"
//                   value={(form as any).deadline_1 ?? ""}
//                   onChange={handleChange}
//                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-medium mb-1">2차 마감일</label>
//                 <input
//                   type="date"
//                   name="deadline_2"
//                   value={(form as any).deadline_2 ?? ""}
//                   onChange={handleChange}
//                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-medium mb-1">
//                   최종 마감일 <span className="text-red-500">*</span>
//                 </label>
//                 <input
//                   type="date"
//                   name="deadline_final"
//                   value={(form as any).deadline_final ?? ""}
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
//                   title={!canSubmit ? "필수값을 입력하세요 (프로젝트명/과목/최종 마감일/팀)" : ""}
//                 >
//                   {createLoading ? "등록 중..." : "등록"}
//                 </button>
//               </div>

//               {!canSubmit && (
//                 <div className="text-xs text-gray-500 pt-1">
//                   프로젝트명/과목/최종 마감일{isLead ? "/프로젝트 소속 팀" : ""}을 입력해야 등록할 수 있습니다.
//                 </div>
//               )}
//             </form>
//           </div>
//         </div>
//       )}

//       <ProjectBulkDeleteModal
//         open={isDeleteModalOpen}
//         projects={selectedProjects}
//         loading={bulkDeleteLoading}
//         onCancel={() => setIsDeleteModalOpen(false)}
//         onConfirm={() => void confirmBulkDelete()}
//       />

//       <div className="space-y-6">
//         <PendingApprovalsSection />
//       </div>
//     </div>
//   );
// }


// // // FILE: frontend/src/pages/ProjectAdminPage.tsx

// // import React, { useEffect, useMemo, useState } from "react";
// // import PendingApprovalsSection from "@/pages/PendingApprovalsSection";
// // import ProjectListTable from "@/components/projects/ProjectListTable";
// // import type { ViewOption } from "@/components/projects/ProjectListTable";
// // import ProjectBulkDeleteModal from "@/components/projects/ProjectBulkDeleteModal";
// // import { Trash2 } from "lucide-react";

// // import {
// //   fetchProjects,
// //   createProject,
// //   Project,
// //   CreateProjectRequest,
// //   deleteProject,
// // } from "../data/files/api";

// // function trimOrEmpty(v: unknown): string {
// //   return typeof v === "string" ? v.trim() : "";
// // }

// // export default function ProjectAdminPage() {
// //   const [projects, setProjects] = useState<Project[]>([]);
// //   const [isModalOpen, setIsModalOpen] = useState(false);

// //   const [form, setForm] = useState<CreateProjectRequest>({
// //     name: "",
// //     subject: "물리",
// //     year: "2026",

// //     category: "기타",

// //     // NEW multi deadlines
// //     deadline_1: "",
// //     deadline_2: "",
// //     deadline_final: "",

// //     // Legacy (optional): keep sending for backward compatibility; we map it to deadline_final at submit
// //     deadline: "",
// //   });

// //   const [listLoading, setListLoading] = useState(false);
// //   const [createLoading, setCreateLoading] = useState(false);
// //   const [error, setError] = useState<string | null>(null);

// //   // selection
// //   const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
// //   const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
// //   const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

// //   const years = useMemo(() => ["전체", "2025", "2026", "2027"], []);
// //   const subjects = useMemo(() => ["전체", "물리", "화학", "생명과학", "지구과학"], []);
// //   const viewOptions = useMemo<ViewOption[]>(() => ["진행중인 프로젝트만", "모두 보기"], []);

// //   // Category list (easy to change later)
// //   const categories = useMemo(() => ["시대인재", "시대인재북스", "기타"], []);

// //   const canSubmit = useMemo(() => {
// //     const name = trimOrEmpty(form.name);
// //     const subject = trimOrEmpty(form.subject);
// //     const deadlineFinal = trimOrEmpty(form.deadline_final ?? "");
// //     return !!name && !!subject && !!deadlineFinal && !createLoading;
// //   }, [form.name, form.subject, form.deadline_final, createLoading]);

// //   useEffect(() => {
// //     void loadProjects();
// //   }, []);

// //   const loadProjects = async () => {
// //     try {
// //       setListLoading(true);
// //       setError(null);
// //       const data = await fetchProjects();
// //       setProjects(data);
// //       setSelectedIds(new Set());
// //     } catch (e) {
// //       console.error(e);
// //       setError("프로젝트 목록을 불러오는 데 실패했습니다.");
// //     } finally {
// //       setListLoading(false);
// //     }
// //   };

// //   const handleChange = (
// //     e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
// //   ) => {
// //     const { name, value } = e.target;
// //     setForm((prev) => ({ ...prev, [name]: value }));
// //   };

// //   const resetForm = () => {
// //     setForm({
// //       name: "",
// //       subject: "물리",
// //       year: "2026",

// //       category: "기타",

// //       deadline_1: "",
// //       deadline_2: "",
// //       deadline_final: "",

// //       deadline: "",
// //     });
// //   };

// //   const handleSubmit = async (e: React.FormEvent) => {
// //     e.preventDefault();

// //     const payload: CreateProjectRequest = {
// //       name: trimOrEmpty(form.name),
// //       subject: trimOrEmpty(form.subject),
// //       year: trimOrEmpty(form.year) || null,

// //       category: trimOrEmpty(form.category ?? "") || "기타",

// //       deadline_1: trimOrEmpty(form.deadline_1 ?? "") || null,
// //       deadline_2: trimOrEmpty(form.deadline_2 ?? "") || null,
// //       deadline_final: trimOrEmpty(form.deadline_final ?? "") || null,

// //       // Legacy: send final as deadline for compatibility
// //       deadline: trimOrEmpty(form.deadline_final ?? "") || null,
// //     };

// //     if (!payload.name || !payload.subject || !payload.deadline_final) {
// //       setError("프로젝트명/과목/최종 마감일은 필수입니다.");
// //       return;
// //     }

// //     try {
// //       setCreateLoading(true);
// //       setError(null);
// //       const newProject = await createProject(payload);
// //       setProjects((prev) => [...prev, newProject]);
// //       resetForm();
// //       setIsModalOpen(false);
// //     } catch (e) {
// //       console.error(e);
// //       setError("프로젝트 생성에 실패했습니다.");
// //     } finally {
// //       setCreateLoading(false);
// //     }
// //   };

// //   // single delete (kept)
// //   const handleDeleteOne = async (id: number) => {
// //     if (!window.confirm("정말 삭제하시겠습니까?")) return;
// //     try {
// //       await deleteProject(id);
// //       setProjects((prev) => prev.filter((p) => p.id !== id));
// //       setSelectedIds((prev) => {
// //         const next = new Set(prev);
// //         next.delete(id);
// //         return next;
// //       });
// //     } catch (e) {
// //       console.error(e);
// //       setError("프로젝트 삭제에 실패했습니다.");
// //     }
// //   };

// //   const toggleSelect = (id: number) => {
// //     setSelectedIds((prev) => {
// //       const next = new Set(prev);
// //       if (next.has(id)) next.delete(id);
// //       else next.add(id);
// //       return next;
// //     });
// //   };

// //   const toggleSelectAllOnPage = (idsOnPage: number[]) => {
// //     setSelectedIds((prev) => {
// //       const next = new Set(prev);
// //       const allSelected = idsOnPage.every((id) => next.has(id));
// //       if (allSelected) idsOnPage.forEach((id) => next.delete(id));
// //       else idsOnPage.forEach((id) => next.add(id));
// //       return next;
// //     });
// //   };

// //   const selectedProjects = useMemo(() => {
// //     if (selectedIds.size === 0) return [];
// //     const map = new Map(projects.map((p) => [p.id, p]));
// //     return Array.from(selectedIds)
// //       .map((id) => map.get(id))
// //       .filter(Boolean) as Project[];
// //   }, [projects, selectedIds]);

// //   const openBulkDelete = () => {
// //     if (selectedIds.size === 0) return;
// //     setIsDeleteModalOpen(true);
// //   };

// //   const confirmBulkDelete = async () => {
// //     if (selectedProjects.length === 0) {
// //       setIsDeleteModalOpen(false);
// //       return;
// //     }

// //     try {
// //       setBulkDeleteLoading(true);
// //       setError(null);

// //       for (const p of selectedProjects) {
// //         await deleteProject(p.id);
// //       }

// //       const deleted = new Set(selectedProjects.map((p) => p.id));
// //       setProjects((prev) => prev.filter((p) => !deleted.has(p.id)));
// //       setSelectedIds(new Set());
// //       setIsDeleteModalOpen(false);
// //     } catch (e) {
// //       console.error(e);
// //       setError("프로젝트 일괄 삭제에 실패했습니다.");
// //     } finally {
// //       setBulkDeleteLoading(false);
// //     }
// //   };

// //   return (
// //     <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
// //       <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex items-center justify-between">
// //         <div>
// //           <h1 className="text-xl font-semibold">프로젝트 관리자 페이지</h1>
// //           <p className="text-sm text-gray-500">
// //             프로젝트를 등록하고 현재 등록된 프로젝트 목록을 관리합니다.
// //           </p>
// //         </div>

// //         <div className="flex items-center gap-2">
// //           <button
// //             type="button"
// //             onClick={openBulkDelete}
// //             disabled={selectedIds.size === 0}
// //             title={selectedIds.size === 0 ? "삭제할 프로젝트를 선택하세요" : "선택 항목 삭제"}
// //             className={[
// //               "rounded-xl border px-3 py-2 text-sm font-medium inline-flex items-center gap-2",
// //               selectedIds.size === 0
// //                 ? "border-gray-200 text-gray-300"
// //                 : "border-red-200 text-red-700 hover:bg-red-50",
// //             ].join(" ")}
// //           >
// //             <Trash2 className="h-4 w-4" />
// //             삭제
// //             {selectedIds.size > 0 ? (
// //               <span className="text-xs">({selectedIds.size})</span>
// //             ) : null}
// //           </button>

// //           <button
// //             type="button"
// //             onClick={() => setIsModalOpen(true)}
// //             className="rounded-xl border border-indigo-500 bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
// //           >
// //             프로젝트 등록
// //           </button>
// //         </div>
// //       </section>

// //       {error && (
// //         <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
// //           {error}
// //         </div>
// //       )}

// //       {listLoading ? (
// //         <div className="rounded-2xl border bg-white p-4 shadow-sm text-sm text-gray-500">
// //           프로젝트 목록을 불러오는 중입니다...
// //         </div>
// //       ) : (
// //         <ProjectListTable
// //           title="등록된 프로젝트 목록"
// //           projects={projects}
// //           years={years}
// //           subjects={subjects}
// //           viewOptions={viewOptions}
// //           actionHeader="삭제"
// //           renderAction={(p) => (
// //             <button
// //               onClick={(e) => {
// //                 e.stopPropagation();
// //                 void handleDeleteOne(p.id);
// //               }}
// //               className="text-red-500 hover:underline text-xs"
// //               title="단일 삭제"
// //             >
// //               삭제
// //             </button>
// //           )}
// //           pageSize={10}
// //           selectable
// //           selectedIds={selectedIds}
// //           onToggleSelect={toggleSelect}
// //           onToggleSelectAll={toggleSelectAllOnPage}
// //         />
// //       )}

// //       {isModalOpen && (
// //         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
// //           <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
// //             <h2 className="mb-4 text-lg font-semibold">새 프로젝트 등록</h2>

// //             <form onSubmit={handleSubmit} className="space-y-3">
// //               <div>
// //                 <label className="block text-sm font-medium mb-1">학년도</label>
// //                 <select
// //                   name="year"
// //                   value={form.year ?? ""}
// //                   onChange={handleChange}
// //                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
// //                 >
// //                   <option value="2025">2025년도</option>
// //                   <option value="2026">2026년도</option>
// //                   <option value="2027">2027년도</option>
// //                 </select>
// //               </div>

// //               <div>
// //                 <label className="block text-sm font-medium mb-1">카테고리</label>
// //                 <select
// //                   name="category"
// //                   value={form.category ?? "기타"}
// //                   onChange={handleChange}
// //                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
// //                 >
// //                   {categories.map((c) => (
// //                     <option key={c} value={c}>
// //                       {c}
// //                     </option>
// //                   ))}
// //                 </select>
// //               </div>

// //               <div>
// //                 <label className="block text-sm font-medium mb-1">
// //                   프로젝트명 <span className="text-red-500">*</span>
// //                 </label>
// //                 <input
// //                   type="text"
// //                   name="name"
// //                   value={form.name ?? ""}
// //                   onChange={handleChange}
// //                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
// //                   placeholder="예) 2026년 3월 모의고사"
// //                 />
// //               </div>

// //               <div>
// //                 <label className="block text-sm font-medium mb-1">
// //                   과목 <span className="text-red-500">*</span>
// //                 </label>
// //                 <select
// //                   name="subject"
// //                   value={form.subject ?? ""}
// //                   onChange={handleChange}
// //                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
// //                 >
// //                   <option value="물리">물리</option>
// //                   <option value="화학">화학</option>
// //                   <option value="생명과학">생명과학</option>
// //                   <option value="지구과학">지구과학</option>
// //                 </select>
// //               </div>

// //               <div>
// //                 <label className="block text-sm font-medium mb-1">1차 마감일</label>
// //                 <input
// //                   type="date"
// //                   name="deadline_1"
// //                   value={form.deadline_1 ?? ""}
// //                   onChange={handleChange}
// //                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
// //                 />
// //               </div>

// //               <div>
// //                 <label className="block text-sm font-medium mb-1">2차 마감일</label>
// //                 <input
// //                   type="date"
// //                   name="deadline_2"
// //                   value={form.deadline_2 ?? ""}
// //                   onChange={handleChange}
// //                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
// //                 />
// //               </div>

// //               <div>
// //                 <label className="block text-sm font-medium mb-1">
// //                   최종 마감일 <span className="text-red-500">*</span>
// //                 </label>
// //                 <input
// //                   type="date"
// //                   name="deadline_final"
// //                   value={form.deadline_final ?? ""}
// //                   onChange={handleChange}
// //                   className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
// //                 />
// //               </div>

// //               <div className="mt-4 flex justify-end gap-2">
// //                 <button
// //                   type="button"
// //                   onClick={() => {
// //                     setIsModalOpen(false);
// //                     setError(null);
// //                     resetForm();
// //                   }}
// //                   className="rounded-xl border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
// //                   disabled={createLoading}
// //                 >
// //                   취소
// //                 </button>
// //                 <button
// //                   type="submit"
// //                   className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-60"
// //                   disabled={!canSubmit}
// //                   title={!canSubmit ? "필수값을 입력하세요 (프로젝트명/과목/최종 마감일)" : ""}
// //                 >
// //                   {createLoading ? "등록 중..." : "등록"}
// //                 </button>
// //               </div>

// //               {!canSubmit && (
// //                 <div className="text-xs text-gray-500 pt-1">
// //                   프로젝트명/과목/최종 마감일을 입력해야 등록할 수 있습니다.
// //                 </div>
// //               )}
// //             </form>
// //           </div>
// //         </div>
// //       )}

// //       <ProjectBulkDeleteModal
// //         open={isDeleteModalOpen}
// //         projects={selectedProjects}
// //         loading={bulkDeleteLoading}
// //         onCancel={() => setIsDeleteModalOpen(false)}
// //         onConfirm={() => void confirmBulkDelete()}
// //       />

// //       <div className="space-y-6">
// //         <PendingApprovalsSection />
// //       </div>
// //     </div>
// //   );
// // }

