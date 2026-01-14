// FILE: frontend/src/pages/ProjectAdminPage.tsx

import React, { useEffect, useMemo, useState } from "react";
import PendingApprovalsSection from "@/pages/PendingApprovalsSection";
import ProjectListTable from "@/components/projects/ProjectListTable";
import type { ViewOption } from "@/components/projects/ProjectListTable";
import ProjectBulkDeleteModal from "@/components/projects/ProjectBulkDeleteModal";
import { Trash2 } from "lucide-react";

import { getAuthedUser } from "@/auth";

import { DEPARTMENTS, DEPARTMENT_LABEL, prettyDepartment } from "@/data/departments";
import type { Department } from "@/data/departments";

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

function deptLabel(v: string) {
  return prettyDepartment(v);
}

function getSubjectCode(p: Project): string {
  const code = trimOrEmpty((p as any).__subject_code ?? (p as any).owner_department ?? "");
  return code;
}

export default function ProjectAdminPage() {
  const me = getAuthedUser();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [form, setForm] = useState<CreateProjectRequest & { owner_department?: string }>({
    name: "",
    subject: "PHYSICS_1" as any,
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
  const subjects = useMemo(() => ["전체", ...DEPARTMENTS.map((d) => DEPARTMENT_LABEL[d])], []);
  const viewOptions = useMemo<ViewOption[]>(() => ["진행중인 프로젝트만", "모두 보기"], []);

  const categories = useMemo(() => ["시대인재", "시대인재북스", "기타"], []);

  const role = (me?.role ?? "MEMBER") as "ADMIN" | "LEAD" | "MEMBER" | "PENDING";
  const isAdmin = role === "ADMIN";
  const isLead = role === "LEAD";

  // ✅ multi departments (preferred) + legacy fallback
  const myDepartments = useMemo(() => {
    const multi = Array.isArray((me as any)?.departments) ? (((me as any).departments as string[]) ?? []) : [];
    const legacy = typeof (me as any)?.department === "string" ? [String((me as any).department)] : [];
    // remove ADMIN if it exists by accident
    return uniqStr([...multi, ...legacy]).filter((d) => d && d !== "ADMIN");
  }, [me]);

  // ADMIN/LEAD can open create modal (UX gating)
  const canCreateAny = useMemo(() => isAdmin || isLead, [isAdmin, isLead]);

  const leadOwnerOptions = useMemo(() => {
    // only allow known departments
    const known = new Set<string>(DEPARTMENTS as unknown as string[]);
    return myDepartments.filter((d) => known.has(d));
  }, [myDepartments]);

  const canSubmit = useMemo(() => {
    const name = trimOrEmpty(form.name);
    const subject = trimOrEmpty(form.subject);
    const deadlineFinal = trimOrEmpty((form as any).deadline_final ?? "");

    if (!name || !subject || !deadlineFinal) return false;
    if (!canCreateAny) return false;

    // subject must be one of Department codes
    const known = new Set<string>(DEPARTMENTS as unknown as string[]);
    if (!known.has(subject)) return false;

    if (isLead) {
      const od = trimOrEmpty((form as any).owner_department ?? "");
      if (!od) return false;
      if (!leadOwnerOptions.includes(od)) return false;

      // enforce subject === owner_department for LEAD
      if (subject !== od) return false;
    } else if (isAdmin) {
      // admin: if owner_department is set, it must be valid
      const od = trimOrEmpty((form as any).owner_department ?? "");
      if (od) {
        const known2 = new Set<string>(DEPARTMENTS as unknown as string[]);
        if (!known2.has(od)) return false;
      }
    }

    return !createLoading;
  }, [
    form.name,
    form.subject,
    (form as any).deadline_final,
    createLoading,
    canCreateAny,
    isLead,
    isAdmin,
    leadOwnerOptions,
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

      // ✅ keep subject CODE for permissions, show label for UI
      const normalized = data.map((p) => {
        const code = trimOrEmpty((p as any).subject);
        return {
          ...p,
          __subject_code: code,
          subject: deptLabel(code),
        };
      }) as Project[];

      setProjects(normalized);
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

    setForm((prev) => {
      const next: any = { ...prev, [name]: value };

      // ✅ if owner_department changes, keep subject in sync (single concept)
      if (name === "owner_department") {
        const od = trimOrEmpty(value);
        if (od) next.subject = od;
      }

      // ✅ if subject changes (admin), and owner_department is empty, optionally keep it aligned
      if (name === "subject") {
        const s = trimOrEmpty(value);
        if (isLead) {
          // LEAD cannot diverge: force owner_department too
          next.owner_department = s;
        }
      }

      return next;
    });
  };

  const resetForm = () => {
    setForm({
      name: "",
      subject: "PHYSICS_1" as any,
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
      if (cur && leadOwnerOptions.includes(cur)) return prev;
      const first = leadOwnerOptions[0] ?? "";
      // subject must match
      return { ...prev, owner_department: first, subject: first };
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

  // ✅ LEAD: delete only own dept projects
  const canDeleteProject = (p: Project) => {
    if (isAdmin) return true;
    if (!isLead) return false;

    const code = getSubjectCode(p);
    if (!code) return false;
    return leadOwnerOptions.includes(code);
  };

  const denyMsgForProject = (p: Project) => {
    if (isAdmin) return "";
    if (!isLead) return "권한이 없습니다.";
    const code = getSubjectCode(p);
    if (!code) return "이 프로젝트는 소속팀 정보가 없어 LEAD 권한으로 관리할 수 없습니다.";
    return "다른 팀 프로젝트는 삭제할 수 없습니다.";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canCreateAny) {
      alert("권한이 없습니다. (ADMIN/LEAD만 프로젝트를 생성할 수 있습니다.)");
      return;
    }

    const subject = trimOrEmpty(form.subject);
    const ownerDept = trimOrEmpty((form as any).owner_department ?? "");

    if (isLead) {
      if (!ownerDept) {
        setError("LEAD 계정은 프로젝트 소속 팀을 반드시 선택해야 합니다.");
        return;
      }
      if (!leadOwnerOptions.includes(ownerDept)) {
        setError("선택한 팀이 본인 소속 팀이 아닙니다.");
        return;
      }
      if (subject !== ownerDept) {
        setError("과목과 소속 팀은 동일해야 합니다.");
        return;
      }
    }

    const payload: CreateProjectRequest = {
      name: trimOrEmpty(form.name),
      subject, // ✅ Department code
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

      const payloadWithOwner = payload as any;

      // ✅ owner_department always same as subject if set
      if (isLead) {
        payloadWithOwner.owner_department = ownerDept;
      } else {
        // admin: if owner_department not set, default to subject
        payloadWithOwner.owner_department = ownerDept || subject || null;
      }

      const newProject = await createProject(payloadWithOwner);

      const code = trimOrEmpty((newProject as any).subject);
      const normalized = {
        ...newProject,
        __subject_code: code,
        subject: deptLabel(code),
      } as Project;

      setProjects((prev) => [...prev, normalized]);
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
                <span className="text-gray-700_toggle_scrollbar text-gray-700">
                  {myDepartments.map(deptLabel).join(", ") || "-"}
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
                className={["text-xs", allowed ? "text-red-500 hover:underline" : "text-gray-300 cursor-not-allowed"].join(
                  " "
                )}
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
              {(isLead || isAdmin) && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    과목/소속 팀 <span className="text-red-500">*</span>
                  </label>

                  {/* LEAD: only their departments. ADMIN: all departments */}
                  <select
                    name={isAdmin ? "subject" : "owner_department"}
                    value={
                      isLead ? trimOrEmpty((form as any).owner_department ?? "") : trimOrEmpty((form as any).subject ?? "")
                    }
                    onChange={handleChange}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    {isLead ? (
                      leadOwnerOptions.length === 0 ? (
                        <option value="" disabled>
                          (소속 팀이 없습니다) 관리자에게 문의하세요
                        </option>
                      ) : null
                    ) : null}

                    {(isAdmin ? (DEPARTMENTS as unknown as string[]) : leadOwnerOptions).map((d) => (
                      <option key={d} value={d}>
                        {deptLabel(d)}
                      </option>
                    ))}
                  </select>

                  <div className="text-xs text-gray-500 mt-1">
                    {isLead
                      ? "LEAD는 본인 소속 과목(팀)만 프로젝트를 생성할 수 있어요."
                      : "과목(팀)을 선택하면 프로젝트 과목/권한 소속이 동일하게 저장됩니다."}
                  </div>
                </div>
              )}

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
                <div className="text-xs text-gray-500 pt-1">프로젝트명/과목(팀)/최종 마감일을 입력해야 등록할 수 있습니다.</div>
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

