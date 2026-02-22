import React, { useCallback, useEffect, useRef, useState } from "react";
import PendingApprovalsSection from "@/pages/PendingApprovalsSection";
import PendingPasswordChangesSection from "@/pages/PendingPasswordChangesSection";
import { fetchAllUsers, deleteUser, updateUser, type AdminUser } from "@/data/files/adminUsersApi";
import { getAuthedUser } from "@/auth";
import { usePendingCount } from "@/hooks/usePendingCount";
import {
  DEPARTMENTS,
  DEPARTMENT_LABEL,
  prettyDepartment,
} from "@/data/departments";
import FilterDropdown from "@/components/FilterDropdown";

const ROLES: { value: string | null; label: string }[] = [
  { value: null, label: "전체" },
  { value: "ADMIN", label: "ADMIN" },
  { value: "LEAD", label: "LEAD" },
  { value: "MEMBER", label: "MEMBER" },
  { value: "PENDING", label: "PENDING" },
];

/** 편집용 역할: LEAD, MEMBER만 변경 가능 (ADMIN은 변경 불가, ADMIN으로 변경 불가, PENDING 제외) */
const ROLE_EDIT_OPTIONS: { value: string; label: string }[] = [
  { value: "LEAD", label: "LEAD" },
  { value: "MEMBER", label: "MEMBER" },
];

/** 편집용 소속 팀 목록 */
const DEPT_OPTIONS_EDIT = DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABEL[d] }));

function getUserDepartmentCodes(u: AdminUser): string[] {
  const multi = Array.isArray(u.departments) ? u.departments : [];
  const legacy = u.department ? [u.department] : [];
  return [...new Set([...multi, ...legacy])].filter(Boolean);
}

function maskPhone(phone?: string | null): string {
  if (!phone) return "-";
  if (phone.length === 11) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
  if (phone.length === 10) return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
  return phone;
}

function formatDepartments(u: AdminUser): string {
  const multi = Array.isArray(u.departments) ? u.departments : [];
  const legacy = u.department ? [u.department] : [];
  const merged = [...new Set([...multi, ...legacy])].filter(Boolean);
  if (merged.length === 0) return "-";
  return merged.map((d) => prettyDepartment(d)).join(", ");
}

const DEPARTMENT_OPTIONS = [
  { value: null as string | null, label: "전체" },
  ...DEPARTMENTS.map((d) => ({ value: d as string | null, label: DEPARTMENT_LABEL[d] })),
];

type TabId = "all" | "pending" | "password";

export default function UserManagementPage() {
  const me = getAuthedUser();
  const adminId = me?.id ?? null;
  const isAdmin = me?.role === "ADMIN";
  const { signupPendingCount, passwordPendingCount } = usePendingCount();

  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filterDepartment, setFilterDepartment] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [openDropdown, setOpenDropdown] = useState<{ userId: number; field: "role" | "department" } | null>(null);
  const [editingDepartments, setEditingDepartments] = useState<{ userId: number; selected: string[] } | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const loadUsers = useCallback(async () => {
    if (!adminId || !isAdmin) return;
    setErr(null);
    setLoading(true);
    try {
      const list = await fetchAllUsers(adminId, {
        department: filterDepartment ?? undefined,
        role: filterRole ?? undefined,
      });
      setUsers(list);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [adminId, isAdmin, filterDepartment, filterRole]);

  useEffect(() => {
    if (adminId && isAdmin && activeTab === "all") void loadUsers();
  }, [adminId, isAdmin, activeTab, loadUsers]);

  useEffect(() => {
    if (openDropdown == null) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
        if (openDropdown?.field === "department") setEditingDepartments(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openDropdown]);

  async function handleDeleteUser(u: AdminUser) {
    if (!adminId) return;
    if (!window.confirm(`정말 "${u.name || u.username}" 계정을 삭제하시겠습니까? 삭제된 계정은 복구할 수 없습니다.`)) return;
    setErr(null);
    setDeletingId(u.id);
    try {
      await deleteUser(adminId, u.id);
      await loadUsers();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "계정 삭제에 실패했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleChangeRole(u: AdminUser, role: string) {
    if (!adminId) return;
    setOpenDropdown(null);
    setErr(null);
    setUpdatingId(u.id);
    try {
      const updated = await updateUser(adminId, u.id, { role: role as AdminUser["role"] });
      setUsers((prev) => prev.map((uu) => (uu.id === u.id ? updated : uu)));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "역할 변경에 실패했습니다.");
    } finally {
      setUpdatingId(null);
    }
  }

  function openDepartmentDropdown(u: AdminUser) {
    setOpenDropdown((prev) =>
      prev?.userId === u.id && prev?.field === "department" ? null : { userId: u.id, field: "department" }
    );
    setEditingDepartments({ userId: u.id, selected: getUserDepartmentCodes(u) });
  }

  function toggleDepartmentChoice(userId: number, dep: string) {
    setEditingDepartments((prev) => {
      if (!prev || prev.userId !== userId) return prev;
      const has = prev.selected.includes(dep);
      const next = has ? prev.selected.filter((d) => d !== dep) : [...prev.selected, dep];
      return { ...prev, selected: next };
    });
  }

  async function handleApplyDepartments(u: AdminUser) {
    const editing = editingDepartments?.userId === u.id ? editingDepartments.selected : getUserDepartmentCodes(u);
    if (!adminId || editing.length === 0) return;
    setOpenDropdown(null);
    setEditingDepartments(null);
    setErr(null);
    setUpdatingId(u.id);
    try {
      const updated = await updateUser(adminId, u.id, { departments: editing });
      setUsers((prev) => prev.map((uu) => (uu.id === u.id ? updated : uu)));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "소속 팀 변경에 실패했습니다.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
      {/* 상단 헤더: 프로젝트 관리와 동일 컨셉 */}
      <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-5 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">유저 관리</h1>
          <p className="text-sm leading-6 text-slate-600">가입 요청 승인 및 유저 관리를 수행합니다.</p>
        </div>
      </section>

      {err && (
        <div className="rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-900">
          {err}
        </div>
      )}

      {/* 목록 카드: 프로젝트 관리 등록된 프로젝트 목록과 동일한 섹션 스타일 */}
      <section className="max-w-full overflow-hidden rounded-3xl border border-slate-200/60 bg-white/80 p-5 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
        {/* 탭 */}
        <div className="flex gap-1 border-b border-slate-200 mb-4">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition ${
              activeTab === "all"
                ? "border border-slate-200 border-b-0 bg-white text-slate-900 -mb-px"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            전체 유저 목록
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("pending")}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition ${
              activeTab === "pending"
                ? "border border-slate-200 border-b-0 bg-white text-slate-900 -mb-px"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            가입 요청
            {signupPendingCount > 0 && (
              <span className="tab-badge">{signupPendingCount}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("password")}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition ${
              activeTab === "password"
                ? "border border-slate-200 border-b-0 bg-white text-slate-900 -mb-px"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            비밀번호 변경 요청
            {passwordPendingCount > 0 && (
              <span className="tab-badge">{passwordPendingCount}</span>
            )}
          </button>
        </div>

        {activeTab === "pending" && <PendingApprovalsSection embedded />}
        {activeTab === "password" && <PendingPasswordChangesSection embedded />}

        {activeTab === "all" && !isAdmin && (
          <div className="rounded-2xl border border-amber-200/60 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
            전체 유저 목록은 ADMIN 계정에서만 이용할 수 있어요.
          </div>
        )}

        {activeTab === "all" && isAdmin && loading && (
          <div className="text-sm text-slate-600 py-6">
            유저 목록을 불러오는 중입니다...
          </div>
        )}

        {activeTab === "all" && isAdmin && !loading && (
          <>
            {/* 필터: 프로젝트 관리 LabeledSelect와 동일 레이아웃 */}
            <div className="flex flex-wrap items-end gap-4 mb-4">
              <FilterDropdown<string | null>
                label="소속 팀 선택"
                value={filterDepartment}
                options={DEPARTMENT_OPTIONS}
                onChange={setFilterDepartment}
              />
              <FilterDropdown<string | null>
                label="부여된 역할 선택"
                value={filterRole}
                options={ROLES}
                onChange={setFilterRole}
              />
            </div>

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">등록된 유저 목록</h2>
              <div className="text-xs text-slate-500">
                {users.length}명
              </div>
            </div>

            {/* 테이블: ProjectListTable과 동일한 래퍼/thead/td 스타일 */}
            <div className="w-full max-w-full rounded-2xl border border-slate-200/60 bg-white overflow-hidden">
              <div className="max-w-full overflow-x-auto" style={{ scrollbarGutter: "stable" }}>
                <table className="min-w-[720px] w-full text-sm">
                  <thead className="bg-slate-50/90 backdrop-blur sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">이름 / 아이디</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">소속 팀</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">역할</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">전화번호</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-slate-500 text-sm" colSpan={5}>
                          조건에 맞는 유저가 없어요.
                        </td>
                      </tr>
                    ) : (
                      users.map((u) => (
                        <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-900">{u.name || "-"}</span>
                              <span className="text-xs text-slate-500">{u.username}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div
                              ref={openDropdown?.userId === u.id && openDropdown?.field === "department" ? dropdownRef : undefined}
                              className="relative"
                            >
                              <button
                                type="button"
                                onClick={() => openDepartmentDropdown(u)}
                                disabled={updatingId !== null}
                                className="text-left text-slate-700 hover:bg-slate-100 rounded-lg px-2 py-1 -mx-2 -my-1 min-w-[80px] disabled:opacity-50"
                              >
                                {updatingId === u.id ? "변경 중…" : formatDepartments(u)}
                              </button>
                              {openDropdown?.userId === u.id && openDropdown?.field === "department" && (
                                <div className="absolute left-0 top-full z-20 mt-1 min-w-[160px] rounded-xl border border-slate-200 bg-white py-2 shadow-lg">
                                  <div className="max-h-[200px] overflow-y-auto px-2">
                                    {DEPT_OPTIONS_EDIT.map((opt) => {
                                      const selected = editingDepartments?.userId === u.id ? editingDepartments.selected : [];
                                      const checked = selected.includes(opt.value);
                                      return (
                                        <label
                                          key={opt.value}
                                          className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer rounded-lg"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleDepartmentChoice(u.id, opt.value)}
                                            className="rounded border-slate-300"
                                          />
                                          {opt.label}
                                        </label>
                                      );
                                    })}
                                  </div>
                                  <div className="border-t border-slate-100 mt-2 pt-2 px-2">
                                    <button
                                      type="button"
                                      onClick={() => void handleApplyDepartments(u)}
                                      disabled={
                                        !editingDepartments ||
                                        editingDepartments.userId !== u.id ||
                                        editingDepartments.selected.length === 0 ||
                                        updatingId !== null
                                      }
                                      className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      적용
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {u.role === "ADMIN" ? (
                              <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-800">
                                ADMIN
                              </span>
                            ) : (
                              <div
                                ref={openDropdown?.userId === u.id && openDropdown?.field === "role" ? dropdownRef : undefined}
                                className="relative"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenDropdown((prev) =>
                                      prev?.userId === u.id && prev?.field === "role" ? null : { userId: u.id, field: "role" }
                                    )
                                  }
                                  disabled={updatingId !== null}
                                  className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium hover:ring-2 hover:ring-slate-300 disabled:opacity-50"
                                >
                                  <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                      u.role === "LEAD"
                                        ? "bg-amber-100 text-amber-800"
                                        : u.role === "PENDING"
                                          ? "bg-slate-100 text-slate-600"
                                          : "bg-slate-100 text-slate-700"
                                    }`}
                                  >
                                    {updatingId === u.id ? "변경 중…" : u.role}
                                  </span>
                                </button>
                                {openDropdown?.userId === u.id && openDropdown?.field === "role" && (
                                  <div className="absolute left-0 top-full z-20 mt-1 min-w-[100px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                                    {ROLE_EDIT_OPTIONS.map((opt) => (
                                      <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => void handleChangeRole(u, opt.value)}
                                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{maskPhone(u.phone_number)}</td>
                          <td className="px-4 py-3">
                            {u.role === "ADMIN" ? (
                              <button
                                type="button"
                                disabled
                                className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-400 cursor-not-allowed"
                              >
                                삭제
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleDeleteUser(u)}
                                disabled={deletingId !== null}
                                className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {deletingId === u.id ? "삭제 중…" : "삭제"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3">
              <div className="text-xs text-slate-500">
                {users.length}명 표시
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
